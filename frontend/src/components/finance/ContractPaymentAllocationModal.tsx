import { useMemo } from "react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { formatMoney } from "../../utils/money";
import { parseMoneyInput } from "../../utils/moneyInput";
import {
  type AllocJobRow,
  type LinkedJobPreview,
  computeAllocationSummary,
} from "../../utils/paymentAllocation";

type Props = {
  open: boolean;
  onClose: () => void;
  employeeName: string;
  paymentAmount: string;
  onPaymentAmountChange: (value: string) => void;
  allowAmountOverride?: boolean;
  linkedJobsPreview: LinkedJobPreview[];
  linkedJobIds: number[];
  activeJobs: AllocJobRow[];
  loading: boolean;
  allocLines: Record<number, string>;
  onToggleJob: (jobId: number, checked: boolean) => void;
  onAllocationChange: (jobId: number, raw: string, maxBalance: unknown) => void;
  onConfirm: () => void;
  busy: boolean;
  busyId: number | null;
  transactionId: number | null;
};

export function ContractPaymentAllocationModal({
  open,
  onClose,
  employeeName,
  paymentAmount,
  onPaymentAmountChange,
  allowAmountOverride = true,
  linkedJobsPreview,
  linkedJobIds,
  activeJobs,
  loading,
  allocLines,
  onToggleJob,
  onAllocationChange,
  onConfirm,
  busy,
  busyId,
  transactionId
}: Props) {
  const { selectedTotal, paymentTotal, remaining } = useMemo(
    () => computeAllocationSummary(allocLines, paymentAmount),
    [allocLines, paymentAmount]
  );
  const allocationsMatch = paymentTotal > 0 && Math.abs(remaining) < 0.005;
  const hasSelectedJobs = Object.keys(allocLines).length > 0;

  return (
    <Modal
      open={open}
      title={employeeName ? `Allocate payment — ${employeeName}` : "Allocate payment"}
      onClose={() => (busy || loading ? null : onClose())}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-3 text-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-black/55">Employee</div>
              <div className="mt-0.5 font-bold">{employeeName || "—"}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-black/55">Payment amount</div>
              <div className="mt-0.5 font-extrabold tabular-nums">{formatMoney(paymentTotal)}</div>
            </div>
          </div>
        </div>

        <div className="text-sm text-black/70">
          Select one or more unpaid jobs and allocate amounts. Total allocations must equal the payment amount.
        </div>

        {linkedJobsPreview.length || linkedJobIds.length ? (
          <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-3 text-sm">
            <div className="text-xs font-semibold text-black/55">Linked to this payment</div>
            <ul className="mt-2 space-y-2">
              {(linkedJobsPreview.length
                ? linkedJobsPreview
                : linkedJobIds.map((id) => ({ id, status: "linked", final_price: null }))
              ).map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-2">
                  <span className="font-semibold">Job #{j.id}</span>
                  <span className="text-xs font-semibold text-black/55">{j.status}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {allowAmountOverride ? (
          <label className="text-xs font-semibold text-black/60">
            Amount to pay (optional adjustment)
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={paymentAmount}
              onChange={(e) => onPaymentAmountChange(e.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </label>
        ) : null}

        {loading ? (
          <div className="text-sm text-black/60">Loading jobs…</div>
        ) : activeJobs.length === 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            No active jobs available for allocation
          </div>
        ) : (
          <>
            <div className="md:hidden space-y-3">
              {activeJobs.map((j) => {
                const v = allocLines[j.id] ?? "";
                const checked = typeof allocLines[j.id] !== "undefined";
                return (
                  <div
                    key={j.id}
                    className={[
                      "rounded-2xl border bg-white p-4",
                      checked ? "border-black/30 ring-2 ring-black/10" : "border-black/10"
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => onToggleJob(j.id, e.target.checked)}
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

                    <label className="mt-3 block text-xs font-semibold text-black/60">
                      Allocate amount
                      <input
                        className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold text-right"
                        disabled={!checked}
                        value={v}
                        onChange={(e) => onAllocationChange(j.id, e.target.value, j.balance)}
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
                  {activeJobs.map((j) => {
                    const v = allocLines[j.id] ?? "";
                    const checked = typeof allocLines[j.id] !== "undefined";
                    return (
                      <tr key={j.id} className={["border-b border-black/5", checked ? "bg-black/[0.03]" : ""].join(" ")}>
                        <td className="py-2 pr-3">
                          <input type="checkbox" checked={checked} onChange={(e) => onToggleJob(j.id, e.target.checked)} />
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
                            onChange={(e) => onAllocationChange(j.id, e.target.value, j.balance)}
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

        {hasSelectedJobs ? (
          <div className="rounded-2xl border border-black/10 bg-white p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-black/55">Selected total</div>
                <div className="mt-0.5 font-extrabold tabular-nums">{formatMoney(selectedTotal)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold text-black/55">Remaining</div>
                <div
                  className={[
                    "mt-0.5 font-extrabold tabular-nums",
                    remaining < -0.005 ? "text-red-700" : remaining > 0.005 ? "text-amber-800" : "text-emerald-800"
                  ].join(" ")}
                >
                  {formatMoney(remaining)}
                </div>
              </div>
            </div>
            {!allocationsMatch && hasSelectedJobs ? (
              <div className="mt-2 text-xs font-semibold text-amber-800">
                Allocations must total {formatMoney(paymentTotal)} before marking paid.
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            isLoading={busy && busyId === transactionId}
            disabled={!transactionId || busy || loading || !hasSelectedJobs || !allocationsMatch}
            onClick={onConfirm}
          >
            Mark paid
          </Button>
          <Button variant="ghost" disabled={busy || loading} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
