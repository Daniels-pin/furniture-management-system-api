import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { contractEmployeesApi, employeePaymentsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { formatMoney } from "../utils/money";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";
import type { ContractEmployeeDetail } from "../types/api";

export function ContractEmployeeDetailPage() {
  const auth = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { contractEmployeeId } = useParams();
  const id = Number(contractEmployeeId);

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ContractEmployeeDetail | null>(null);

  const [owedAmt, setOwedAmt] = useState("");
  const [owedNote, setOwedNote] = useState("");
  const [payAmt, setPayAmt] = useState("");
  const [payNote, setPayNote] = useState("");
  const [busy, setBusy] = useState(false);

  const [reverseTargetId, setReverseTargetId] = useState<number | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);

  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const backTo = "/employees?tab=contract";

  useEffect(() => {
    if (!Number.isFinite(id)) {
      setLoading(false);
      setDetail(null);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const d = await contractEmployeesApi.get(id);
        if (!alive) return;
        setDetail(d);
      } catch (err) {
        toast.push("error", getErrorMessage(err));
        if (!alive) return;
        setDetail(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, toast]);

  const title = useMemo(() => detail?.full_name ?? "Contract employee", [detail?.full_name]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <div className="text-2xl font-bold tracking-tight truncate">{title}</div>
          <div className="mt-1 text-sm text-black/60">Contract employee profile and transactions.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {auth.role === "admin" ? (
            <Button
              variant="danger"
              disabled={!detail || deleting}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              Delete Employee
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => nav(backTo)}>
            Back
          </Button>
        </div>
      </div>

      {loading ? (
        <Card>
          <div className="text-sm text-black/60">Loading…</div>
        </Card>
      ) : !detail ? (
        <Card>
          <div className="text-sm text-black/60">Not found.</div>
          <div className="mt-3">
            <Link className="text-sm font-semibold text-black underline decoration-black/30 underline-offset-2" to={backTo}>
              Back to contract employees
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Financial summary</div>
            <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                <div className="text-xs font-semibold text-black/60">Total owed</div>
                <div className="mt-1 font-bold tabular-nums">{formatMoney(detail.total_owed)}</div>
              </div>
              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                <div className="text-xs font-semibold text-black/60">Total paid</div>
                <div className="mt-1 font-bold tabular-nums">{formatMoney(detail.total_paid)}</div>
              </div>
              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                <div className="text-xs font-semibold text-black/60">Balance</div>
                <div className="mt-1 font-bold tabular-nums">{formatMoney(detail.balance)}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-black/50">Balance \(=\) owed − paid. Positive means the company owes the employee.</div>
          </Card>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="!p-4">
              <div className="text-sm font-semibold text-black">Increase total owed</div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <label className="text-xs font-semibold text-black/60">
                  Amount (NGN)
                  <input
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={owedAmt}
                    onChange={(e) => setOwedAmt(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </label>
                <label className="text-xs font-semibold text-black/60">
                  Note (optional)
                  <input
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={owedNote}
                    onChange={(e) => setOwedNote(e.target.value)}
                  />
                </label>
                <Button
                  variant="secondary"
                  isLoading={busy}
                  onClick={() => {
                    const amt = parseMoneyInput(owedAmt);
                    if (owedAmt.trim() && !isValidThousandsCommaNumber(owedAmt)) {
                      toast.push("error", "Fix comma formatting in amount.");
                      return;
                    }
                    if (amt === null || Number.isNaN(amt) || amt <= 0) {
                      toast.push("error", "Enter a valid amount (> 0).");
                      return;
                    }
                    setBusy(true);
                    void contractEmployeesApi
                      .increaseOwed(detail.id, { amount: amt, note: owedNote.trim() || null })
                      .then((d) => {
                        setDetail(d);
                        setOwedAmt("");
                        setOwedNote("");
                        toast.push("success", "Owed increased.");
                      })
                      .catch((e) => toast.push("error", getErrorMessage(e)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Increase owed
                </Button>
              </div>
            </Card>

            <Card className="!p-4">
              <div className="text-sm font-semibold text-black">Send payment to Finance</div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <label className="text-xs font-semibold text-black/60">
                  Amount (NGN)
                  <input
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={payAmt}
                    onChange={(e) => setPayAmt(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </label>
                <label className="text-xs font-semibold text-black/60">
                  Note (optional)
                  <input
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                  />
                </label>
                <Button
                  isLoading={busy}
                  onClick={() => {
                    const amt = parseMoneyInput(payAmt);
                    if (payAmt.trim() && !isValidThousandsCommaNumber(payAmt)) {
                      toast.push("error", "Fix comma formatting in amount.");
                      return;
                    }
                    if (amt === null || Number.isNaN(amt) || amt <= 0) {
                      toast.push("error", "Enter a valid amount (> 0).");
                      return;
                    }
                    setBusy(true);
                    void contractEmployeesApi
                      .sendPaymentToFinance(detail.id, { amount: amt, note: payNote.trim() || null })
                      .then(() => contractEmployeesApi.get(detail.id))
                      .then((d) => {
                        setDetail(d);
                        setPayAmt("");
                        setPayNote("");
                        toast.push("success", "Sent to Finance.");
                      })
                      .catch((e) => toast.push("error", getErrorMessage(e)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Send to Finance
                </Button>
              </div>
            </Card>
          </div>

          <Card className="!p-4">
            <div className="flex items-end justify-between gap-2">
              <div className="text-sm font-semibold text-black">Transactions</div>
              <Button
                variant="secondary"
                onClick={() => {
                  void employeePaymentsApi
                    .exportTransactions({ contract_employee_id: detail.id })
                    .then(() => toast.push("success", "Export downloaded."))
                    .catch((e) => toast.push("error", getErrorMessage(e)));
                }}
              >
                Export CSV
              </Button>
            </div>
            {detail.transactions.length === 0 ? (
              <div className="mt-2 text-sm text-black/60">No transactions yet.</div>
            ) : (
              <ul className="mt-3 divide-y divide-black/10 rounded-xl border border-black/10">
                {detail.transactions
                  .slice()
                  .reverse()
                  .map((t) => (
                    <li
                      key={t.id}
                      className={[
                        "px-3 py-2 text-sm",
                        t.status === "pending"
                          ? "bg-black/[0.03]"
                          : t.status === "cancelled"
                            ? "bg-black/[0.015] opacity-70"
                            : "bg-emerald-50/40"
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold">
                          {t.txn_type === "owed_increase" ? "Owed increase" : t.txn_type === "reversal" ? "Reversal" : "Payment"}
                        </div>
                        <div className="font-bold tabular-nums">{formatMoney(t.amount)}</div>
                      </div>
                      <div className="mt-0.5 text-xs text-black/55">
                        {new Date(t.created_at).toLocaleString()} •{" "}
                        <span className="font-semibold">
                          {t.status === "pending" ? "Pending" : t.status === "cancelled" ? "Cancelled" : "Paid"}
                        </span>
                        {typeof t.running_balance !== "undefined" && t.running_balance !== null
                          ? ` • Balance: ${formatMoney(t.running_balance)}`
                          : ""}
                      </div>
                      {typeof t.running_balance !== "undefined" && t.running_balance !== null && Number(t.running_balance) < 0 ? (
                        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-900">
                          Overpaid (Employee owes company)
                        </div>
                      ) : null}
                      {t.note ? <div className="mt-1 text-xs text-black/60">{t.note}</div> : null}
                      <div className="mt-2 flex justify-end gap-2">
                        {auth.role === "admin" && t.status === "pending" && t.txn_type === "payment" ? (
                          <Button variant="danger" onClick={() => setCancelTargetId(t.id)}>
                            Cancel
                          </Button>
                        ) : null}
                        {t.status === "paid" && t.txn_type !== "reversal" ? (
                          <Button variant="danger" onClick={() => setReverseTargetId(t.id)}>
                            Reverse
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          <Modal
            open={cancelTargetId !== null}
            title="Cancel pending payment"
            onClose={() => (cancelling ? null : setCancelTargetId(null))}
          >
            {cancelTargetId !== null ? (
              <div className="space-y-4">
                <div className="text-sm text-black/70">Are you sure you want to cancel this pending payment?</div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    isLoading={cancelling}
                    onClick={() => {
                      if (cancelTargetId === null) return;
                      setCancelling(true);
                      void employeePaymentsApi
                        .cancelPending(cancelTargetId)
                        .then(() => contractEmployeesApi.get(detail.id))
                        .then((d) => setDetail(d))
                        .then(() => toast.push("success", "Cancelled."))
                        .then(() => setCancelTargetId(null))
                        .catch((e) => toast.push("error", getErrorMessage(e)))
                        .finally(() => setCancelling(false));
                    }}
                  >
                    Yes
                  </Button>
                  <Button variant="ghost" disabled={cancelling} onClick={() => setCancelTargetId(null)}>
                    No
                  </Button>
                </div>
              </div>
            ) : null}
          </Modal>

          <Modal open={reverseTargetId !== null} title="Reverse transaction" onClose={() => (reversing ? null : setReverseTargetId(null))}>
            {reverseTargetId !== null ? (
              <div className="space-y-4">
                <div className="text-sm text-black/70">
                  This does <span className="font-semibold">not delete</span> the original record. It creates a new reversal transaction.
                </div>
                <label className="text-xs font-semibold text-black/60">
                  Reason (optional)
                  <input
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={reverseReason}
                    onChange={(e) => setReverseReason(e.target.value)}
                    placeholder="Reason…"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    isLoading={reversing}
                    onClick={() => {
                      if (reverseTargetId === null) return;
                      setReversing(true);
                      void employeePaymentsApi
                        .reverse(reverseTargetId, { reason: reverseReason.trim() || undefined })
                        .then(() => contractEmployeesApi.get(detail.id))
                        .then((d) => setDetail(d))
                        .then(() => toast.push("success", "Reversed."))
                        .then(() => {
                          setReverseTargetId(null);
                          setReverseReason("");
                        })
                        .catch((e) => toast.push("error", getErrorMessage(e)))
                        .finally(() => setReversing(false));
                    }}
                  >
                    Reverse transaction
                  </Button>
                  <Button variant="ghost" disabled={reversing} onClick={() => setReverseTargetId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </Modal>

          <Modal
            open={confirmDeleteOpen}
            title="Delete contract employee"
            onClose={() => (deleting ? null : setConfirmDeleteOpen(false))}
          >
            <div className="space-y-4">
              <div className="text-sm text-black/70 text-center">
                Are you sure you want to delete this employee? This action cannot be undone.
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="danger"
                  isLoading={deleting}
                  disabled={!detail}
                  onClick={() => {
                    if (!detail) return;
                    setDeleting(true);
                    void contractEmployeesApi
                      .remove(detail.id)
                      .then((res) => {
                        if (res.action === "deleted") {
                          toast.push("success", "Employee deleted.");
                          const r = Date.now();
                          nav(`${backTo}${backTo.includes("?") ? "&" : "?"}r=${r}`, { replace: true });
                          return;
                        }
                        toast.push("success", "Employee has transactions and was marked inactive.");
                        return contractEmployeesApi.get(detail.id).then((d) => setDetail(d));
                      })
                      .catch((e) => toast.push("error", getErrorMessage(e)))
                      .finally(() => {
                        setDeleting(false);
                        setConfirmDeleteOpen(false);
                      });
                  }}
                >
                  Yes
                </Button>
                <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDeleteOpen(false)}>
                  No
                </Button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}

