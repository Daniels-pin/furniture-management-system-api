import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { contractEmployeeAdminSecurityApi, contractEmployeesApi, contractJobsApi, employeePaymentsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { formatMoney } from "../utils/money";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";
import type { ContractEmployeeDetail, ContractJob } from "../types/api";
import {
  getFinancialActivityClasses,
  getFinancialActivityColor,
  getFinancialActivityStatusLabel,
  getFinancialActivityTypeLabel
} from "../utils/financialActivity";

function JobStatusBadge({ status }: { status: ContractJob["status"] }) {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset";
  const cls =
    status === "pending"
      ? "bg-black/5 text-black/70 ring-black/10"
      : status === "in_progress"
        ? "bg-yellow-100 text-yellow-900 ring-yellow-200"
        : status === "completed"
          ? "bg-green-100 text-green-900 ring-green-200"
          : status === "cancelled"
            ? "bg-red-100 text-red-900 ring-red-200"
            : "bg-black/5 text-black/70 ring-black/10";
  const label =
    status === "in_progress"
      ? "In Progress"
      : status === "cancelled"
        ? "Cancelled"
        : status[0].toUpperCase() + status.slice(1);
  return <span className={[base, cls].join(" ")}>{label}</span>;
}

export function ContractEmployeeDetailPage() {
  const auth = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { contractEmployeeId } = useParams();
  const id = Number(contractEmployeeId);
  const tab = (searchParams.get("tab") || "finances") as "jobs" | "finances";
  const selectedJobId = Number(searchParams.get("jobId") || "");

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ContractEmployeeDetail | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobs, setJobs] = useState<ContractJob[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDesc, setAssignDesc] = useState("");
  const [assignPrice, setAssignPrice] = useState("");
  const [assignImageFile, setAssignImageFile] = useState<File | null>(null);
  const [assigning, setAssigning] = useState(false);

  const [owedAmt, setOwedAmt] = useState("");
  const [owedNote, setOwedNote] = useState("");
  const [owedDecAmt, setOwedDecAmt] = useState("");
  const [owedDecNote, setOwedDecNote] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payRequestId, setPayRequestId] = useState<number | null>(null);
  const [payNowAmt, setPayNowAmt] = useState("");
  const [busy, setBusy] = useState(false);

  const [reverseTargetId, setReverseTargetId] = useState<number | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);

  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetPw, setResetPw] = useState("");
  const [resetForce, setResetForce] = useState(true);
  const [resetting, setResetting] = useState(false);

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
        const [d, j] = await Promise.all([contractEmployeesApi.get(id), contractJobsApi.listAdmin({ employee_id: id })]);
        if (!alive) return;
        setDetail(d);
        setJobs(j);
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
  const inProgressJobs = useMemo(() => jobs.filter((j) => j.status === "in_progress"), [jobs]);
  const completedJobs = useMemo(() => jobs.filter((j) => j.status === "completed"), [jobs]);
  const eligiblePaymentRequests = useMemo(() => {
    const txns = Array.isArray(detail?.transactions) ? detail!.transactions : [];
    return txns
      .filter((t) => t?.txn_type === "payment" && (t.status === "requested" || t.status === "approved_by_admin"))
      .slice()
      .sort((a, b) => Number(b.id) - Number(a.id));
  }, [detail]);

  const selectedPayRequest = useMemo(() => {
    if (!eligiblePaymentRequests.length || payRequestId === null) return null;
    return eligiblePaymentRequests.find((t) => Number(t.id) === Number(payRequestId)) ?? null;
  }, [eligiblePaymentRequests, payRequestId]);

  useEffect(() => {
    // Keep a stable default selection (newest eligible request).
    if (!eligiblePaymentRequests.length) {
      setPayRequestId(null);
      return;
    }
    setPayRequestId((prev) => {
      if (prev && eligiblePaymentRequests.some((t) => Number(t.id) === Number(prev))) return prev;
      return Number(eligiblePaymentRequests[0].id);
    });
  }, [eligiblePaymentRequests]);

  useEffect(() => {
    // Default "amount to pay" to the selected request amount.
    if (!selectedPayRequest) {
      setPayNowAmt("");
      return;
    }
    setPayNowAmt(String(selectedPayRequest.amount ?? ""));
  }, [selectedPayRequest?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedJob = useMemo(
    () => (Number.isFinite(selectedJobId) ? jobs.find((j) => j.id === selectedJobId) ?? null : null),
    [jobs, selectedJobId]
  );

  function setTab(next: "jobs" | "finances") {
    const sp = new URLSearchParams(searchParams);
    sp.set("tab", next);
    if (next !== "jobs") sp.delete("jobId");
    setSearchParams(sp, { replace: true });
  }

  async function refreshJobs() {
    if (!Number.isFinite(id)) return;
    setJobsLoading(true);
    try {
      const j = await contractJobsApi.listAdmin({ employee_id: id });
      setJobs(j);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setJobsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <div className="text-2xl font-bold tracking-tight truncate">{title}</div>
          <div className="mt-1 text-sm text-black/60">Contract employee details, jobs, and finances.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {auth.role === "admin" ? (
            <Button variant="secondary" disabled={!detail} onClick={() => setResetOpen(true)}>
              Reset Password
            </Button>
          ) : null}
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
          <div className="inline-flex rounded-2xl border border-black/10 bg-white p-1">
            <button
              type="button"
              onClick={() => setTab("jobs")}
              className={[
                "min-h-10 rounded-xl px-3 text-sm font-semibold",
                tab === "jobs" ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
              ].join(" ")}
            >
              Jobs
            </button>
            <button
              type="button"
              onClick={() => setTab("finances")}
              className={[
                "min-h-10 rounded-xl px-3 text-sm font-semibold",
                tab === "finances" ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
              ].join(" ")}
            >
              Finances
            </button>
          </div>

          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Employee</div>
            <div className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                <div className="text-xs font-semibold text-black/60">Name</div>
                <div className="mt-1 font-bold">{detail.full_name}</div>
              </div>
              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                <div className="text-xs font-semibold text-black/60">Phone</div>
                <div className="mt-1 font-bold">{detail.phone ?? "Not provided"}</div>
              </div>
              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                <div className="text-xs font-semibold text-black/60">Bank</div>
                <div className="mt-1 font-bold">{(detail as any).bank_name ?? "Not provided"}</div>
              </div>
              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                <div className="text-xs font-semibold text-black/60">Account</div>
                <div className="mt-1 font-mono text-xs font-bold">{detail.account_number ?? "Not provided"}</div>
              </div>
            </div>
          </Card>

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

          {tab === "jobs" ? (
            <>
              <Card className="!p-4">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div className="text-sm font-semibold text-black">Job preview</div>
                  <div className="flex flex-wrap gap-2">
                    {auth.role === "admin" ? (
                      <Button onClick={() => setAssignOpen(true)}>Assign Job</Button>
                    ) : null}
                    <Button variant="secondary" isLoading={jobsLoading} onClick={() => void refreshJobs()}>
                      Refresh
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-black/55">In progress</div>
                    {inProgressJobs.length === 0 ? (
                      <div className="mt-2 text-sm text-black/60">No jobs in progress.</div>
                    ) : (
                      <ul className="mt-2 divide-y divide-black/10 rounded-2xl border border-black/10">
                        {inProgressJobs.slice(0, 6).map((j) => (
                          <li key={j.id} className="px-3 py-2 text-sm">
                            <button
                              type="button"
                              className="w-full text-left"
                              onClick={() => {
                                const sp = new URLSearchParams(searchParams);
                                sp.set("tab", "jobs");
                                sp.set("jobId", String(j.id));
                                setSearchParams(sp);
                              }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="font-semibold">Job #{j.id}</div>
                                <JobStatusBadge status={j.status} />
                              </div>
                              <div className="mt-1 text-xs text-black/60">
                                {j.description ? `Desc: ${j.description}` : ""}
                                {j.description ? " • " : ""}
                                Price: {j.final_price ? formatMoney(j.final_price) : j.price_offer ? formatMoney(j.price_offer) : "—"}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-black/55">Completed</div>
                    {completedJobs.length === 0 ? (
                      <div className="mt-2 text-sm text-black/60">No completed jobs yet.</div>
                    ) : (
                      <ul className="mt-2 divide-y divide-black/10 rounded-2xl border border-black/10">
                        {completedJobs.slice(0, 6).map((j) => (
                          <li key={j.id} className="px-3 py-2 text-sm">
                            <button
                              type="button"
                              className="w-full text-left"
                              onClick={() => {
                                const sp = new URLSearchParams(searchParams);
                                sp.set("tab", "jobs");
                                sp.set("jobId", String(j.id));
                                setSearchParams(sp);
                              }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="font-semibold">Job #{j.id}</div>
                                <JobStatusBadge status={j.status} />
                              </div>
                              <div className="mt-1 text-xs text-black/60">
                                {j.description ? `Desc: ${j.description}` : ""}
                                {j.description ? " • " : ""}
                                Price: {j.final_price ? formatMoney(j.final_price) : "—"}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </Card>

              <Card className="!p-4">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div className="text-sm font-semibold text-black">Open job details</div>
                  <Button
                    variant="secondary"
                    disabled={!selectedJob}
                    onClick={() => {
                      if (!selectedJob) return;
                      nav(`/admin/jobs/${selectedJob.id}`);
                    }}
                  >
                    View selected job
                  </Button>
                </div>
                {!selectedJob ? (
                  <div className="mt-2 text-sm text-black/60">Select a job above, then open it in the full job detail page.</div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-black/10 bg-black/[0.02] p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold">Job #{selectedJob.id}</div>
                      <JobStatusBadge status={selectedJob.status} />
                    </div>
                    <div className="mt-1 text-xs text-black/60 line-clamp-2">{(selectedJob.description || "").trim() || "—"}</div>
                    <div className="mt-2 text-xs text-black/60">
                      Price:{" "}
                      <span className="font-semibold text-black tabular-nums">
                        {selectedJob.final_price
                          ? formatMoney(selectedJob.final_price)
                          : selectedJob.price_offer
                            ? formatMoney(selectedJob.price_offer)
                            : "—"}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-black/55">
                      All job actions (renegotiate, accept, cancel, override) are handled on the full job detail page.
                    </div>
                  </div>
                )}
              </Card>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Card className="!p-4">
                  <div className="text-sm font-semibold text-black">Increase total owed</div>
                  <div className="mt-2 text-xs text-black/55">Requires a note/reason. Creates a transaction record.</div>
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
                      Note / reason (required)
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
                        if (!owedNote.trim()) {
                          toast.push("error", "Note is required.");
                          return;
                        }
                        setBusy(true);
                        void contractEmployeesApi
                          .increaseOwed(detail.id, { amount: amt, note: owedNote.trim() })
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
                  <div className="text-sm font-semibold text-black">Decrease total owed</div>
                  <div className="mt-2 text-xs text-black/55">Requires a note/reason. Creates a transaction record.</div>
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    <label className="text-xs font-semibold text-black/60">
                      Amount (NGN)
                      <input
                        className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                        value={owedDecAmt}
                        onChange={(e) => setOwedDecAmt(e.target.value)}
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </label>
                    <label className="text-xs font-semibold text-black/60">
                      Note / reason (required)
                      <input
                        className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                        value={owedDecNote}
                        onChange={(e) => setOwedDecNote(e.target.value)}
                        placeholder="Reason…"
                      />
                    </label>
                    <Button
                      variant="secondary"
                      isLoading={busy}
                      onClick={() => {
                        const amt = parseMoneyInput(owedDecAmt);
                        if (owedDecAmt.trim() && !isValidThousandsCommaNumber(owedDecAmt)) {
                          toast.push("error", "Fix comma formatting in amount.");
                          return;
                        }
                        if (amt === null || Number.isNaN(amt) || amt <= 0) {
                          toast.push("error", "Enter a valid amount (> 0).");
                          return;
                        }
                        if (!owedDecNote.trim()) {
                          toast.push("error", "Note is required.");
                          return;
                        }
                        setBusy(true);
                        void contractEmployeesApi
                          .decreaseOwed(detail.id, { amount: amt, note: owedDecNote.trim() })
                          .then((d) => {
                            setDetail(d);
                            setOwedDecAmt("");
                            setOwedDecNote("");
                            toast.push("success", "Owed decreased.");
                          })
                          .catch((e) => toast.push("error", getErrorMessage(e)))
                          .finally(() => setBusy(false));
                      }}
                    >
                      Decrease owed
                    </Button>
                  </div>
                </Card>

                <Card className="!p-4">
                  <div className="text-sm font-semibold text-black">Send payment to Finance</div>
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    <label className="text-xs font-semibold text-black/60">
                      Request
                      <select
                        className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                        value={payRequestId ?? ""}
                        onChange={(e) => setPayRequestId(e.target.value ? Number(e.target.value) : null)}
                        disabled={busy || eligiblePaymentRequests.length === 0}
                      >
                        {eligiblePaymentRequests.length === 0 ? (
                          <option value="">No eligible requests</option>
                        ) : (
                          eligiblePaymentRequests.map((t) => (
                            <option key={t.id} value={t.id}>
                              #{t.id} • {formatMoney(t.amount)} • {t.status === "requested" ? "Requested" : "Approved"}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-black/60">
                      Amount to Pay (NGN)
                      <input
                        className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                        value={payNowAmt}
                        onChange={(e) => setPayNowAmt(e.target.value)}
                        inputMode="decimal"
                        placeholder="0"
                        disabled={busy || payRequestId === null}
                      />
                      {selectedPayRequest && payNowAmt.trim() ? (
                        (() => {
                          const req = Number(selectedPayRequest.amount ?? 0);
                          const v = parseMoneyInput(payNowAmt);
                          if (v === null || Number.isNaN(v)) return null;
                          if (v < req) {
                            return (
                              <div className="mt-1 text-[12px] font-semibold text-amber-800">
                                Partial payment • Remaining stays in employee balance (request will be closed)
                              </div>
                            );
                          }
                          return null;
                        })()
                      ) : null}
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
                      disabled={eligiblePaymentRequests.length === 0 || payRequestId === null}
                      onClick={() => {
                        if (payRequestId === null) return;
                        if (!selectedPayRequest) return;
                        const amt = parseMoneyInput(payNowAmt);
                        if (payNowAmt.trim() && !isValidThousandsCommaNumber(payNowAmt)) {
                          toast.push("error", "Fix comma formatting in amount.");
                          return;
                        }
                        if (amt === null || Number.isNaN(amt) || amt <= 0) {
                          toast.push("error", "Enter a valid amount (> 0).");
                          return;
                        }
                        const reqAmt = Number(selectedPayRequest.amount ?? 0);
                        const balance = Number(detail.balance ?? 0);
                        if (amt > reqAmt) {
                          toast.push("error", "Amount cannot exceed request amount.");
                          return;
                        }
                        if (amt > balance) {
                          toast.push("error", "Amount cannot exceed remaining balance.");
                          return;
                        }
                        setBusy(true);
                        void contractEmployeesApi
                          .sendPaymentToFinance(detail.id, { request_id: payRequestId, amount: amt, note: payNote.trim() || null })
                          .then(() => contractEmployeesApi.get(detail.id))
                          .then((d) => {
                            setDetail(d);
                            setPayNote("");
                            setPayNowAmt("");
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
                <div className="text-sm font-semibold text-black">Job earnings breakdown</div>
                <div className="mt-2 text-xs text-black/55">Totals are computed from job prices and allocated paid transactions.</div>
                {jobs.length === 0 ? (
                  <div className="mt-2 text-sm text-black/60">No jobs yet.</div>
                ) : (
                  <>
                    <div className="mt-3 md:hidden space-y-3">
                      {jobs
                        .filter((j) => j.status !== "cancelled")
                        .map((j) => (
                          <div key={j.id} className="rounded-2xl border border-black/10 bg-white p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-bold">Job #{j.id}</div>
                                <div className="mt-1">
                                  <JobStatusBadge status={j.status} />
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs font-semibold text-black/55">Balance</div>
                                <div className="mt-0.5 text-base font-bold tabular-nums">
                                  {typeof j.balance !== "undefined" && j.balance !== null ? formatMoney(j.balance) : "—"}
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                                <div className="font-semibold text-black/55">Total</div>
                                <div className="mt-0.5 font-bold tabular-nums">{j.final_price ? formatMoney(j.final_price) : "—"}</div>
                              </div>
                              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                                <div className="font-semibold text-black/55">Paid</div>
                                <div className="mt-0.5 font-bold tabular-nums">{formatMoney(j.amount_paid ?? 0)}</div>
                              </div>
                              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                                <div className="font-semibold text-black/55">Balance</div>
                                <div className="mt-0.5 font-bold tabular-nums">
                                  {typeof j.balance !== "undefined" && j.balance !== null ? formatMoney(j.balance) : "—"}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>

                    <div className="mt-3 hidden md:block min-w-0 overflow-x-auto">
                    <table className="w-full min-w-[920px] text-left text-sm">
                      <thead className="text-black/60">
                        <tr className="border-b border-black/10">
                          <th className="py-3 pr-4 font-semibold">Job</th>
                          <th className="py-3 pr-4 font-semibold">Status</th>
                          <th className="py-3 pr-4 text-right font-semibold">Total price</th>
                          <th className="py-3 pr-4 text-right font-semibold">Paid</th>
                          <th className="py-3 pr-0 text-right font-semibold">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {jobs
                          .filter((j) => j.status !== "cancelled")
                          .map((j) => (
                            <tr key={j.id} className="border-b border-black/5">
                              <td className="py-3 pr-4 font-semibold">#{j.id}</td>
                              <td className="py-3 pr-4">
                                <JobStatusBadge status={j.status} />
                              </td>
                              <td className="py-3 pr-4 text-right font-bold tabular-nums">
                                {j.final_price ? formatMoney(j.final_price) : "—"}
                              </td>
                              <td className="py-3 pr-4 text-right font-bold tabular-nums">
                                {formatMoney(j.amount_paid ?? 0)}
                              </td>
                              <td className="py-3 pr-0 text-right font-bold tabular-nums">
                                {typeof j.balance !== "undefined" && j.balance !== null
                                  ? formatMoney(j.balance)
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    </div>
                  </>
                )}
              </Card>

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
                  .map((t) => {
                    const color = getFinancialActivityColor(t);
                    const cls = getFinancialActivityClasses(color);
                    const typeLabel = getFinancialActivityTypeLabel(t);
                    const statusLabel = getFinancialActivityStatusLabel(t);
                    const relatedJob =
                      typeof (t as any)?.contract_job_id !== "undefined" && (t as any)?.contract_job_id !== null
                        ? `Job #${Number((t as any).contract_job_id)}`
                        : Array.isArray((t as any)?.allocations) && (t as any).allocations.length
                          ? `Jobs: ${(t as any).allocations
                              .slice(0, 4)
                              .map((a: any) => `#${Number(a.contract_job_id)}`)
                              .join(", ")}${(t as any).allocations.length > 4 ? "…" : ""}`
                          : null;

                    return (
                      <li
                      key={t.id}
                      className={[
                        "px-3 py-2 text-sm",
                        cls.bg,
                        cls.text
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold">{typeLabel}</div>
                        <div className="font-bold tabular-nums">{formatMoney(t.amount)}</div>
                      </div>
                      <div className="mt-0.5 text-xs text-black/55">
                        {new Date(t.created_at).toLocaleString()} • <span className="font-semibold">{statusLabel}</span>
                        {relatedJob ? ` • ${relatedJob}` : ""}
                        {typeof t.running_balance !== "undefined" && t.running_balance !== null
                          ? ` • Balance: ${formatMoney(t.running_balance)}`
                          : ""}
                      </div>
                      <div className="mt-2">
                        <span className={["inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset", cls.ring].join(" ")}>
                          {statusLabel}
                        </span>
                      </div>
                      {typeof t.running_balance !== "undefined" && t.running_balance !== null && Number(t.running_balance) < 0 ? (
                        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-900">
                          Overpaid (Employee owes company)
                        </div>
                      ) : null}
                      {t.note ? <div className="mt-1 text-xs text-black/60">{t.note}</div> : null}
                      <div className="mt-2 flex justify-end gap-2">
                        {auth.role === "admin" &&
                        (t.status === "requested" ||
                          t.status === "approved_by_admin" ||
                          t.status === "sent_to_finance" ||
                          t.status === "pending") &&
                        t.txn_type === "payment" ? (
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
                    );
                  })}
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

          <Modal open={resetOpen} title="Reset password" onClose={() => (resetting ? null : setResetOpen(false))}>
            <div className="space-y-4">
              <div className="text-sm text-black/70">
                Set a new password for this contract employee. This takes effect immediately.
              </div>
              <label className="text-xs font-semibold text-black/60">
                New password
                <input
                  className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                  value={resetPw}
                  onChange={(e) => setResetPw(e.target.value)}
                  type="password"
                  autoComplete="new-password"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-black/70">
                <input
                  type="checkbox"
                  checked={resetForce}
                  onChange={(e) => setResetForce(e.target.checked)}
                />
                Force password change on next login (recommended)
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  isLoading={resetting}
                  disabled={!detail}
                  onClick={() => {
                    if (!detail) return;
                    if (resetPw.trim().length < 8) {
                      toast.push("error", "Password must be at least 8 characters.");
                      return;
                    }
                    setResetting(true);
                    void contractEmployeeAdminSecurityApi
                      .resetPassword(detail.id, { new_password: resetPw, force_change_on_next_login: resetForce })
                      .then(() => toast.push("success", "Password reset."))
                      .then(() => {
                        setResetOpen(false);
                        setResetPw("");
                        setResetForce(true);
                      })
                      .catch((e) => toast.push("error", getErrorMessage(e)))
                      .finally(() => setResetting(false));
                  }}
                >
                  Reset
                </Button>
                <Button variant="ghost" disabled={resetting} onClick={() => setResetOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </Modal>
            </>
          )}
        </>
      )}

      <Modal open={assignOpen} title="Assign Job" onClose={() => (assigning ? null : setAssignOpen(false))}>
        <div className="space-y-3">
          <label className="text-xs font-semibold text-black/60">
            Description <span className="text-red-600">*</span>
            <textarea
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold min-h-[96px]"
              value={assignDesc}
              onChange={(e) => setAssignDesc(e.target.value)}
              placeholder="Describe the job…"
            />
          </label>
          <label className="text-xs font-semibold text-black/60">
            Price offer (optional)
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={assignPrice}
              onChange={(e) => setAssignPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </label>
          <label className="text-xs font-semibold text-black/60">
            Image (optional)
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              type="file"
              accept="image/*"
              onChange={(e) => setAssignImageFile((e.target.files && e.target.files[0]) || null)}
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" disabled={assigning} onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={assigning}
              onClick={() => {
                if (!Number.isFinite(id)) return;
                if (!assignDesc.trim()) {
                  toast.push("error", "Description is required.");
                  return;
                }
                if (assignPrice.trim() && !isValidThousandsCommaNumber(assignPrice)) {
                  toast.push("error", "Fix comma formatting in amount.");
                  return;
                }
                const offer = assignPrice.trim() ? parseMoneyInput(assignPrice) : null;
                if (assignPrice.trim() && (offer === null || Number.isNaN(offer) || offer <= 0)) {
                  toast.push("error", "Enter a valid offer (> 0) or leave it blank.");
                  return;
                }
                setAssigning(true);
                void (async () => {
                  let imageUrl: string | null = null;
                  if (assignImageFile) {
                    const up = await contractJobsApi.uploadImage(assignImageFile);
                    imageUrl = up.image_url;
                  }
                  await contractJobsApi.createAdmin({
                    contract_employee_id: id,
                    description: assignDesc.trim(),
                    image_url: imageUrl || undefined,
                    price_offer: offer ?? undefined
                  });
                })()
                  .then(() => refreshJobs())
                  .then(() => {
                    setAssignDesc("");
                    setAssignPrice("");
                    setAssignImageFile(null);
                    setAssignOpen(false);
                    toast.push("success", "Job assigned.");
                  })
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setAssigning(false));
              }}
            >
              Assign
            </Button>
          </div>
          <div className="text-xs text-black/50">
            Description is required. Image is optional. If you set an offer, the employee can accept or renegotiate.
          </div>
        </div>
      </Modal>
    </div>
  );
}

