import { useEffect, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { contractEmployeesApi, employeePaymentsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import type { PendingEmployeePayments } from "../types/api";
import { formatMoney } from "../utils/money";
import { usePageHeader } from "../components/layout/pageHeader";

export function FinanceDashboardPage() {
  const auth = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingEmployeePayments | null>(null);
  const [sort, setSort] = useState<"oldest" | "newest" | "amount_desc" | "amount_asc">("oldest");
  const [search, setSearch] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [allocOpen, setAllocOpen] = useState(false);
  const [allocLoading, setAllocLoading] = useState(false);
  const [allocTxId, setAllocTxId] = useState<number | null>(null);
  const [allocEmployeeId, setAllocEmployeeId] = useState<number | null>(null);
  const [allocEmployeeName, setAllocEmployeeName] = useState<string>("");
  const [allocAmount, setAllocAmount] = useState<string>("");
  const [allocJobs, setAllocJobs] = useState<
    Array<{ id: number; status: string; final_price?: string | number | null; amount_paid: string | number; balance?: string | number | null }>
  >([]);
  const [allocLines, setAllocLines] = useState<Record<number, string>>({});
  const [overpayConfirm, setOverpayConfirm] = useState(false);
  const [confirmWithoutReceipt, setConfirmWithoutReceipt] = useState(false);

  async function refresh() {
    const res = await employeePaymentsApi.pending({
      search: search.trim() || undefined,
      sort
    });
    setPending(res);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await refresh();
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast, sort, search]);

  usePageHeader({
    title: "Finance Dashboard",
    subtitle: "Pending payments queue and totals."
  });

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-black/55">Total pending</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(pending?.total_pending_amount ?? 0)}</div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold text-black/60">
              Search
              <input
                className="mt-1 w-[240px] rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Employee name…"
              />
            </label>
            <label className="text-xs font-semibold text-black/60">
              Sort
              <select
                className="mt-1 rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                value={sort}
                onChange={(e) => setSort(e.target.value as any)}
              >
                <option value="oldest">Oldest first</option>
                <option value="newest">Newest first</option>
                <option value="amount_desc">Highest amount</option>
                <option value="amount_asc">Lowest amount</option>
              </select>
            </label>
            <Button
              variant="secondary"
              isLoading={loading}
              onClick={() => {
                setLoading(true);
                void refresh()
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setLoading(false));
              }}
            >
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="mt-3 text-sm text-black/60">Loading…</div>
        ) : !pending || pending.items.length === 0 ? (
          <div className="mt-3 text-sm text-black/60">No pending payments.</div>
        ) : (
          <>
            <div className="mt-3 md:hidden space-y-3">
              {pending.items.map((it) => (
                <div key={it.transaction.id} className="rounded-2xl border border-black/10 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{it.employee_name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/70">
                          {it.employee_kind === "monthly" ? "Monthly" : "Contract"}
                        </span>
                        <span className="text-xs font-semibold text-black/55">{it.period_label ?? "—"}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-black/55">Amount</div>
                      <div className="mt-0.5 text-base font-bold tabular-nums">{formatMoney(it.transaction.amount)}</div>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    <div>
                      <div className="text-xs font-semibold text-black/55">Receipt</div>
                      <div className="mt-1">
                        {it.transaction.receipt_url ? (
                          <Button
                            variant="secondary"
                            className="w-full"
                            onClick={() => setPreviewUrl(it.transaction.receipt_url ?? null)}
                          >
                            Preview receipt
                          </Button>
                        ) : (
                          <input
                            type="file"
                            className="block w-full text-sm"
                            disabled={busyId === it.transaction.id}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              setBusyId(it.transaction.id);
                              void employeePaymentsApi
                                .uploadReceipt(it.transaction.id, f)
                                .then(() => refresh())
                                .catch((er) => toast.push("error", getErrorMessage(er)))
                                .finally(() => setBusyId(null));
                            }}
                          />
                        )}
                      </div>
                    </div>

                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={busyId === it.transaction.id || (auth.role === "finance" && !it.transaction.receipt_url)}
                      isLoading={busyId === it.transaction.id}
                      onClick={() => {
                        if (it.employee_kind === "contract") {
                          setAllocOpen(true);
                          setAllocTxId(it.transaction.id);
                          setAllocEmployeeId(it.employee_id);
                          setAllocEmployeeName(it.employee_name);
                          setAllocAmount(String(it.transaction.amount ?? ""));
                          setOverpayConfirm(false);
                          setConfirmWithoutReceipt(auth.role === "admin" && !it.transaction.receipt_url);
                          setAllocLines({});
                          setAllocJobs([]);
                          setAllocLoading(true);
                          void contractEmployeesApi
                            .finances(it.employee_id)
                            .then((d) => setAllocJobs(Array.isArray(d?.jobs) ? d.jobs : []))
                            .catch((er) => toast.push("error", getErrorMessage(er)))
                            .finally(() => setAllocLoading(false));
                          return;
                        }
                        if (auth.role === "admin" && it.transaction.receipt_url) {
                          setBusyId(it.transaction.id);
                          void employeePaymentsApi
                            .markPaid(it.transaction.id)
                            .then(() => refresh())
                            .then(() => toast.push("success", "Marked paid."))
                            .catch((er) => toast.push("error", getErrorMessage(er)))
                            .finally(() => setBusyId(null));
                          return;
                        }
                        setConfirmId(it.transaction.id);
                        setOverpayConfirm(false);
                        setConfirmWithoutReceipt(auth.role === "admin" && !it.transaction.receipt_url);
                      }}
                    >
                      Mark paid
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 hidden md:block min-w-0 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="text-black/60">
                <tr className="border-b border-black/10">
                  <th className="py-3 pr-4 font-semibold">Employee</th>
                  <th className="py-3 pr-4 font-semibold">Kind</th>
                  <th className="py-3 pr-4 font-semibold">Period</th>
                  <th className="py-3 pr-4 text-right font-semibold">Amount</th>
                  <th className="py-3 pr-4 font-semibold">Receipt</th>
                  <th className="py-3 pr-0 text-right font-semibold"> </th>
                </tr>
              </thead>
              <tbody>
                {pending.items.map((it) => (
                  <tr key={it.transaction.id} className="border-b border-black/5 bg-black/[0.03]">
                    <td className="py-3 pr-4 font-semibold">{it.employee_name}</td>
                    <td className="py-3 pr-4">
                      <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/70">
                        {it.employee_kind === "monthly" ? "Monthly" : "Contract"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs font-semibold text-black/60">{it.period_label ?? "—"}</td>
                    <td className="py-3 pr-4 text-right font-bold tabular-nums">{formatMoney(it.transaction.amount)}</td>
                    <td className="py-3 pr-4">
                      {it.transaction.receipt_url ? (
                        <button
                          type="button"
                          className="text-sm font-semibold text-black underline decoration-black/30 underline-offset-2"
                          onClick={() => setPreviewUrl(it.transaction.receipt_url ?? null)}
                        >
                          Preview
                        </button>
                      ) : (
                        <input
                          type="file"
                          className="block text-sm"
                          disabled={busyId === it.transaction.id}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            setBusyId(it.transaction.id);
                            void employeePaymentsApi
                              .uploadReceipt(it.transaction.id, f)
                              .then(() => refresh())
                              .catch((er) => toast.push("error", getErrorMessage(er)))
                              .finally(() => setBusyId(null));
                          }}
                        />
                      )}
                    </td>
                    <td className="py-3 pr-0 text-right">
                      <Button
                        variant="secondary"
                        disabled={
                          busyId === it.transaction.id || (auth.role === "finance" && !it.transaction.receipt_url)
                        }
                        isLoading={busyId === it.transaction.id}
                        onClick={() => {
                          if (it.employee_kind === "contract") {
                            setAllocOpen(true);
                            setAllocTxId(it.transaction.id);
                            setAllocEmployeeId(it.employee_id);
                            setAllocEmployeeName(it.employee_name);
                            setAllocAmount(String(it.transaction.amount ?? ""));
                            setOverpayConfirm(false);
                            setConfirmWithoutReceipt(auth.role === "admin" && !it.transaction.receipt_url);
                            setAllocLines({});
                            setAllocJobs([]);
                            setAllocLoading(true);
                            void contractEmployeesApi
                              .finances(it.employee_id)
                              .then((d) => setAllocJobs(Array.isArray(d?.jobs) ? d.jobs : []))
                              .catch((er) => toast.push("error", getErrorMessage(er)))
                              .finally(() => setAllocLoading(false));
                            return;
                          }
                          if (auth.role === "admin" && it.transaction.receipt_url) {
                            setBusyId(it.transaction.id);
                            void employeePaymentsApi
                              .markPaid(it.transaction.id)
                              .then(() => refresh())
                              .then(() => toast.push("success", "Marked paid."))
                              .catch((er) => toast.push("error", getErrorMessage(er)))
                              .finally(() => setBusyId(null));
                            return;
                          }
                          setConfirmId(it.transaction.id);
                          setOverpayConfirm(false);
                          setConfirmWithoutReceipt(auth.role === "admin" && !it.transaction.receipt_url);
                        }}
                      >
                        Mark paid
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Card>

      <Modal open={previewUrl !== null} title="Receipt preview" onClose={() => setPreviewUrl(null)}>
        {previewUrl ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl border border-black/10">
              <iframe title="Receipt preview" src={previewUrl} className="h-[70dvh] w-full" />
            </div>
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-black/5"
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in new tab
            </a>
          </div>
        ) : null}
      </Modal>

      <Modal open={confirmId !== null} title="Confirm payment" onClose={() => (busyId ? null : setConfirmId(null))}>
        {confirmId ? (
          <div className="space-y-4">
            <div className="text-sm text-black/70">
              {confirmWithoutReceipt ? (
                <>Are you sure you want to proceed without a receipt?</>
              ) : (
                <>
                  Confirm marking this transaction as <span className="font-semibold">Paid</span>?
                </>
              )}
            </div>
            {overpayConfirm ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                <span className="font-semibold">Overpaid.</span> This payment will make the employee owe the company.
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={overpayConfirm ? "danger" : "secondary"}
                isLoading={busyId === confirmId}
                disabled={busyId === confirmId}
                onClick={() => {
                  setBusyId(confirmId);
                  const options =
                    overpayConfirm || confirmWithoutReceipt
                      ? {
                          confirm_overpay: overpayConfirm ? true : undefined,
                          confirm_without_receipt: confirmWithoutReceipt ? true : undefined
                        }
                      : undefined;
                  void employeePaymentsApi
                    .markPaid(confirmId, options)
                    .then(() => refresh())
                    .then(() => toast.push("success", "Marked paid."))
                    .then(() => setConfirmId(null))
                    .catch((er: any) => {
                      const detail = er?.response?.data?.detail;
                      if (detail?.code === "OVERPAY_CONFIRM_REQUIRED") {
                        setOverpayConfirm(true);
                        return;
                      }
                      toast.push("error", getErrorMessage(er));
                    })
                    .finally(() => setBusyId(null));
                }}
              >
                {overpayConfirm ? "Confirm overpay" : confirmWithoutReceipt ? "Yes" : "Confirm"}
              </Button>
              <Button
                variant="ghost"
                disabled={busyId === confirmId}
                onClick={() => {
                  setConfirmId(null);
                  setConfirmWithoutReceipt(false);
                  setOverpayConfirm(false);
                }}
              >
                {confirmWithoutReceipt ? "No" : "Cancel"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={allocOpen}
        title={allocEmployeeName ? `Allocate payment — ${allocEmployeeName}` : "Allocate payment"}
        onClose={() => (busyId || allocLoading ? null : setAllocOpen(false))}
      >
        <div className="space-y-4">
          <div className="text-sm text-black/70">
            Select one or more jobs and allocate amounts. Total allocations must equal the payment amount.
          </div>

          <label className="text-xs font-semibold text-black/60">
            Amount to pay (optional adjustment)
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={allocAmount}
              onChange={(e) => setAllocAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </label>

          {allocLoading ? (
            <div className="text-sm text-black/60">Loading jobs…</div>
          ) : allocJobs.length === 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              No eligible jobs found for allocation.
            </div>
          ) : (
            <>
              <div className="md:hidden space-y-3">
                {allocJobs.map((j) => {
                  const v = allocLines[j.id] ?? "";
                  const checked = typeof allocLines[j.id] !== "undefined";
                  return (
                    <div key={j.id} className="rounded-2xl border border-black/10 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <label className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = { ...allocLines };
                              if (e.target.checked) next[j.id] = next[j.id] ?? "";
                              else delete next[j.id];
                              setAllocLines(next);
                            }}
                            className="mt-1 h-4 w-4"
                            aria-label={`Use job ${j.id}`}
                          />
                          <div>
                            <div className="text-sm font-bold">Job #{j.id}</div>
                            <div className="mt-0.5 text-xs font-semibold text-black/55">{j.status}</div>
                          </div>
                        </label>
                        <div className="text-right text-xs">
                          <div className="font-semibold text-black/55">Balance</div>
                          <div className="mt-0.5 text-sm font-bold tabular-nums">{formatMoney(j.balance ?? 0)}</div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                          <div className="font-semibold text-black/55">Total</div>
                          <div className="mt-0.5 font-bold tabular-nums">{formatMoney(j.final_price ?? 0)}</div>
                        </div>
                        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                          <div className="font-semibold text-black/55">Paid</div>
                          <div className="mt-0.5 font-bold tabular-nums">{formatMoney(j.amount_paid ?? 0)}</div>
                        </div>
                        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                          <div className="font-semibold text-black/55">Balance</div>
                          <div className="mt-0.5 font-bold tabular-nums">{formatMoney(j.balance ?? 0)}</div>
                        </div>
                      </div>

                      <label className="mt-3 block text-xs font-semibold text-black/60">
                        Allocate amount
                        <input
                          className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold text-right"
                          disabled={!checked}
                          value={v}
                          onChange={(e) => setAllocLines({ ...allocLines, [j.id]: e.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block min-w-0 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-black/60">
                  <tr className="border-b border-black/10">
                    <th className="py-2 pr-3 font-semibold">Use</th>
                    <th className="py-2 pr-3 font-semibold">Job</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 text-right font-semibold">Total</th>
                    <th className="py-2 pr-3 text-right font-semibold">Paid</th>
                    <th className="py-2 pr-3 text-right font-semibold">Balance</th>
                    <th className="py-2 pr-0 text-right font-semibold">Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  {allocJobs.map((j) => {
                    const v = allocLines[j.id] ?? "";
                    const checked = typeof allocLines[j.id] !== "undefined";
                    return (
                      <tr key={j.id} className="border-b border-black/5">
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = { ...allocLines };
                              if (e.target.checked) next[j.id] = next[j.id] ?? "";
                              else delete next[j.id];
                              setAllocLines(next);
                            }}
                          />
                        </td>
                        <td className="py-2 pr-3 font-semibold">#{j.id}</td>
                        <td className="py-2 pr-3 text-xs font-semibold text-black/60">{j.status}</td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatMoney(j.final_price ?? 0)}</td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatMoney(j.amount_paid ?? 0)}</td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatMoney(j.balance ?? 0)}</td>
                        <td className="py-2 pr-0 text-right">
                          <input
                            className="w-[140px] rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-right"
                            disabled={!checked}
                            value={v}
                            onChange={(e) => setAllocLines({ ...allocLines, [j.id]: e.target.value })}
                            inputMode="decimal"
                            placeholder="0"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              isLoading={busyId === allocTxId}
              disabled={!allocTxId || busyId === allocTxId || allocLoading}
              onClick={() => {
                if (!allocTxId) return;
                const entries = Object.entries(allocLines)
                  .map(([jobId, amt]) => ({ contract_job_id: Number(jobId), amount: amt }))
                  .filter((x) => x.contract_job_id > 0);
                const cleanedAllocations = entries
                  .map((x) => ({
                    contract_job_id: x.contract_job_id,
                    amount: String(x.amount ?? "").replaceAll(",", "").trim()
                  }))
                  .filter((x) => x.amount);
                setBusyId(allocTxId);
                void employeePaymentsApi
                  .markPaid(
                    allocTxId,
                    confirmWithoutReceipt || overpayConfirm
                      ? {
                          confirm_without_receipt: confirmWithoutReceipt ? true : undefined,
                          confirm_overpay: overpayConfirm ? true : undefined
                        }
                      : undefined,
                    {
                      amount_override: allocAmount?.trim() ? allocAmount.replaceAll(",", "").trim() : null,
                      allocations: cleanedAllocations
                    }
                  )
                  .then(() => refresh())
                  .then(() => toast.push("success", "Marked paid."))
                  .then(() => setAllocOpen(false))
                  .catch((er: any) => {
                    const detail = er?.response?.data?.detail;
                    if (detail?.code === "OVERPAY_CONFIRM_REQUIRED") {
                      setOverpayConfirm(true);
                      return;
                    }
                    toast.push("error", getErrorMessage(er));
                  })
                  .finally(() => setBusyId(null));
              }}
            >
              Mark paid
            </Button>
            <Button variant="ghost" disabled={busyId === allocTxId || allocLoading} onClick={() => setAllocOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

