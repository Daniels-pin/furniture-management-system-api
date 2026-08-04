import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "./ui/Button";
import { contractEmployeesApi, employeePaymentsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { formatLagosDateTime } from "../utils/datetime";
import { formatMoney } from "../utils/money";
import type { ContractEmployeeLedgerEntry } from "../types/api";
import {
  canCancelUnpaidPaymentTransfer,
  getLedgerRowTone,
  getLedgerToneClasses
} from "../utils/financialActivity";

const LEDGER_TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "job_accepted", label: "Job Accepted" },
  { value: "manual_increase", label: "Manual Increase" },
  { value: "manual_deduction", label: "Manual Deduction" },
  { value: "employee_money_request", label: "Employee Money Request" },
  { value: "payment_sent_to_finance", label: "Payment Sent to Finance" },
  { value: "finance_payment_completed", label: "Finance Payment Completed" },
  { value: "payment_reversal", label: "Payment Reversal" },
  { value: "admin_reversal", label: "Admin Reversal" },
  { value: "cancelled_transfer", label: "Cancelled Transfer" }
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "requested", label: "Pending" },
  { value: "approved_by_admin", label: "Awaiting Finance" },
  { value: "sent_to_finance", label: "Awaiting Finance" },
  { value: "paid", label: "Completed" },
  { value: "resolved", label: "Resolved" },
  { value: "cancelled", label: "Cancelled" }
];

const PAGE_SIZE = 20;

function LedgerAmount({ value, tone, kind }: { value: number; tone: ReturnType<typeof getLedgerRowTone>; kind: "credit" | "debit" }) {
  const cls = getLedgerToneClasses(tone);
  if (!value) return <span className="text-black/30">—</span>;
  const prefix = kind === "credit" ? "+" : "−";
  return (
    <span className={["font-semibold tabular-nums", cls.amount].join(" ")}>
      {prefix}
      {formatMoney(value)}
    </span>
  );
}

function LedgerRowActions({
  entry,
  isAdmin,
  onCancel,
  onReverse
}: {
  entry: ContractEmployeeLedgerEntry;
  isAdmin: boolean;
  onCancel(id: number): void;
  onReverse(id: number): void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {isAdmin && entry.txn_type === "payment" && canCancelUnpaidPaymentTransfer(entry.status) ? (
        <Button variant="danger" onClick={() => onCancel(entry.id)}>
          Cancel
        </Button>
      ) : null}
      {entry.status === "paid" && entry.txn_type !== "reversal" ? (
        <Button variant="danger" onClick={() => onReverse(entry.id)}>
          Reverse
        </Button>
      ) : null}
    </div>
  );
}

export function ContractEmployeeLedger({
  employeeId,
  isAdmin,
  refreshKey = 0,
  onCancel,
  onReverse
}: {
  employeeId: number;
  isAdmin: boolean;
  refreshKey?: number;
  onCancel(id: number): void;
  onReverse(id: number): void;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ContractEmployeeLedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [ledgerType, setLedgerType] = useState("");
  const [status, setStatus] = useState("");
  const [jobId, setJobId] = useState("");
  const [paymentRequestId, setPaymentRequestId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    if (!Number.isFinite(employeeId)) return;
    setLoading(true);
    try {
      const res = await contractEmployeesApi.ledger(employeeId, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        sort,
        ...(ledgerType ? { ledger_type: ledgerType } : {}),
        ...(status ? { status } : {}),
        ...(jobId.trim() ? { job_id: Number(jobId) } : {}),
        ...(paymentRequestId.trim() ? { payment_request_id: Number(paymentRequestId) } : {}),
        ...(dateFrom ? { date_from: `${dateFrom}T00:00:00` } : {}),
        ...(dateTo ? { date_to: `${dateTo}T23:59:59` } : {}),
        ...(search.trim() ? { search: search.trim() } : {})
      });
      setItems(Array.isArray(res.items) ? res.items : []);
      setTotal(Number(res.total ?? 0) || 0);
    } catch (err) {
      toast.push("error", getErrorMessage(err));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [employeeId, page, sort, ledgerType, status, jobId, paymentRequestId, dateFrom, dateTo, search, toast]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    setPage(1);
  }, [sort, ledgerType, status, jobId, paymentRequestId, dateFrom, dateTo, search]);

  const hasFilters = useMemo(
    () => Boolean(ledgerType || status || jobId.trim() || paymentRequestId.trim() || dateFrom || dateTo || search.trim()),
    [ledgerType, status, jobId, paymentRequestId, dateFrom, dateTo, search]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-black">Account Ledger</div>
          <div className="mt-0.5 text-xs text-black/55">Running balance after each settled transaction. Pending items do not change the balance until completed.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void employeePaymentsApi
                .exportTransactions({ contract_employee_id: employeeId })
                .then(() => toast.push("success", "Export downloaded."))
                .catch((e) => toast.push("error", getErrorMessage(e)));
            }}
          >
            Export CSV
          </Button>
          <Button variant="secondary" isLoading={loading} onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-semibold text-black/60">
          Search
          <div className="mt-1 flex gap-2">
            <input
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Description, reference, ID…"
              onKeyDown={(e) => {
                if (e.key === "Enter") setSearch(searchDraft);
              }}
            />
            <Button variant="secondary" onClick={() => setSearch(searchDraft)}>
              Go
            </Button>
          </div>
        </label>
        <label className="text-xs font-semibold text-black/60">
          Transaction type
          <select
            className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
            value={ledgerType}
            onChange={(e) => setLedgerType(e.target.value)}
          >
            {LEDGER_TYPE_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-black/60">
          Status
          <select
            className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-black/60">
          Sort
          <select
            className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
            value={sort}
            onChange={(e) => setSort(e.target.value as "newest" | "oldest")}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-black/60">
          Job ID
          <input
            className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
            value={jobId}
            onChange={(e) => setJobId(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="e.g. 514"
          />
        </label>
        <label className="text-xs font-semibold text-black/60">
          Payment request ID
          <input
            className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
            value={paymentRequestId}
            onChange={(e) => setPaymentRequestId(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="e.g. 945"
          />
        </label>
        <label className="text-xs font-semibold text-black/60">
          From date
          <input
            type="date"
            className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="text-xs font-semibold text-black/60">
          To date
          <input
            type="date"
            className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
      </div>

      {hasFilters ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-black/55">Filters active</span>
          <Button
            variant="ghost"
            onClick={() => {
              setLedgerType("");
              setStatus("");
              setJobId("");
              setPaymentRequestId("");
              setDateFrom("");
              setDateTo("");
              setSearch("");
              setSearchDraft("");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-black/60">Loading ledger…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-black/60">No transactions match your filters.</div>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {items.map((entry) => {
              const tone = getLedgerRowTone(entry);
              const cls = getLedgerToneClasses(tone);
              const credit = Number(entry.credit ?? 0);
              const debit = Number(entry.debit ?? 0);
              return (
                <div key={entry.id} className="rounded-2xl border border-black/10 bg-white p-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{entry.transaction_type_label}</div>
                      <div className="mt-1 text-xs text-black/55">{formatLagosDateTime(entry.created_at)}</div>
                    </div>
                    <span className={["inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset", cls.status].join(" ")}>
                      {entry.status_label}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-black/65">{entry.description}</div>
                  <div className="mt-1 text-xs font-semibold text-black/50">{entry.reference}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                      <div className="font-semibold text-black/50">Credit</div>
                      <div className="mt-0.5"><LedgerAmount value={credit} tone={tone} kind="credit" /></div>
                    </div>
                    <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                      <div className="font-semibold text-black/50">Debit</div>
                      <div className="mt-0.5"><LedgerAmount value={debit} tone={tone} kind="debit" /></div>
                    </div>
                    <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                      <div className="font-semibold text-black/50">Balance before</div>
                      <div className="mt-0.5 font-bold tabular-nums">{formatMoney(entry.balance_before)}</div>
                    </div>
                    <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                      <div className="font-semibold text-black/50">Balance after</div>
                      <div className="mt-0.5 font-bold tabular-nums">{formatMoney(entry.balance_after)}</div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <LedgerRowActions entry={entry} isAdmin={isAdmin} onCancel={onCancel} onReverse={onReverse} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden md:block min-w-0 overflow-x-auto rounded-2xl border border-black/10">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-black/[0.02] text-xs uppercase tracking-wide text-black/55">
                <tr className="border-b border-black/10">
                  <th className="px-3 py-3 font-semibold">Date &amp; time</th>
                  <th className="px-3 py-3 font-semibold">Type</th>
                  <th className="px-3 py-3 font-semibold">Description</th>
                  <th className="px-3 py-3 font-semibold">Reference</th>
                  <th className="px-3 py-3 text-right font-semibold">Credit</th>
                  <th className="px-3 py-3 text-right font-semibold">Debit</th>
                  <th className="px-3 py-3 text-right font-semibold">Balance before</th>
                  <th className="px-3 py-3 text-right font-semibold">Balance after</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => {
                  const tone = getLedgerRowTone(entry);
                  const cls = getLedgerToneClasses(tone);
                  const credit = Number(entry.credit ?? 0);
                  const debit = Number(entry.debit ?? 0);
                  return (
                    <tr key={entry.id} className="border-b border-black/5 align-top">
                      <td className="px-3 py-3 text-xs text-black/70 whitespace-nowrap">{formatLagosDateTime(entry.created_at)}</td>
                      <td className="px-3 py-3 font-semibold">{entry.transaction_type_label}</td>
                      <td className="px-3 py-3 max-w-[220px] text-black/75">{entry.description}</td>
                      <td className="px-3 py-3 text-xs font-semibold text-black/55 whitespace-nowrap">{entry.reference}</td>
                      <td className="px-3 py-3 text-right"><LedgerAmount value={credit} tone={tone} kind="credit" /></td>
                      <td className="px-3 py-3 text-right"><LedgerAmount value={debit} tone={tone} kind="debit" /></td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatMoney(entry.balance_before)}</td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums">{formatMoney(entry.balance_after)}</td>
                      <td className="px-3 py-3">
                        <span className={["inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset", cls.status].join(" ")}>
                          {entry.status_label}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <LedgerRowActions entry={entry} isAdmin={isAdmin} onCancel={onCancel} onReverse={onReverse} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-black/55">
          Page {page} of {totalPages}
          {total ? ` • ${total} transaction${total === 1 ? "" : "s"}` : ""}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Prev
          </Button>
          <Button variant="secondary" disabled={loading || page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
