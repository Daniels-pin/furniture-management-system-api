import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { contractJobsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { formatMoney } from "../utils/money";
import type { ContractJob, EmployeeTransaction } from "../types/api";
import { usePageHeader } from "../components/layout/pageHeader";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";

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

function PaidFlagBadge({ paid }: { paid: boolean }) {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset";
  const cls = paid ? "bg-emerald-100 text-emerald-900 ring-emerald-200" : "bg-black/5 text-black/70 ring-black/10";
  return <span className={[base, cls].join(" ")}>{paid ? "Paid" : "Not paid"}</span>;
}

function TimelineRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 text-sm">
      <div className="text-xs font-semibold text-black/60">{label}</div>
      <div className="font-semibold tabular-nums">{value ? new Date(value).toLocaleString() : "—"}</div>
    </div>
  );
}

function isPaidPaymentTxn(t: EmployeeTransaction) {
  return t.txn_type === "payment" && t.status === "paid";
}

export function AdminJobDetailPage() {
  const toast = useToast();
  const nav = useNavigate();
  const { jobId } = useParams();
  const id = Number(jobId);

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<ContractJob | null>(null);

  useEffect(() => {
    if (!Number.isFinite(id)) {
      setLoading(false);
      setJob(null);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const j = await contractJobsApi.get(id);
        if (!alive) return;
        setJob(j);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
        if (!alive) return;
        setJob(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, toast]);

  usePageHeader({
    title: job ? `Job #${job.id}` : "Job",
    subtitle: job ? (job.contract_employee_name || `Employee #${job.contract_employee_id}`) : "Contract job details."
  });

  const paymentTxns = useMemo(() => (job?.linked_transactions ?? []).filter((t) => t.txn_type === "payment"), [job]);
  const firstPaidAt = useMemo(() => {
    const paid = paymentTxns.filter(isPaidPaymentTxn).filter((t) => Boolean(t.paid_at));
    paid.sort((a, b) => new Date(a.paid_at as string).getTime() - new Date(b.paid_at as string).getTime());
    return paid.length ? (paid[0].paid_at ?? null) : null;
  }, [paymentTxns]);

  if (loading) {
    return (
      <Card>
        <div className="text-sm text-black/60">Loading…</div>
      </Card>
    );
  }

  if (!job) {
    return (
      <Card>
        <div className="text-sm text-black/60">Job not found.</div>
        <div className="mt-3">
          <Link className="text-sm font-semibold underline decoration-black/30" to="/admin/jobs">
            ← Back to Jobs
          </Link>
        </div>
      </Card>
    );
  }

  const agreedPrice = job.final_price != null ? job.final_price : job.price_offer != null ? job.price_offer : null;
  const isLocked = Boolean(job.price_accepted_at) || job.final_price != null;
  const adminAccepted = Boolean(job.admin_accepted_at);
  const empAccepted = Boolean(job.employee_accepted_at);
  const needsBoth = Boolean(job.negotiation_occurred);
  const lastBy = (job.last_offer_by_role ?? null) as any;
  const canAdminAccept =
    !isLocked &&
    job.status === "pending" &&
    job.price_offer != null &&
    (needsBoth ? !adminAccepted : lastBy === "contract_employee" && !adminAccepted);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-black/60">
          <Link className="font-semibold underline decoration-black/30" to="/admin/jobs">
            ← Jobs
          </Link>
        </div>
        <Button variant="secondary" onClick={() => nav("/admin/jobs")}>
          Back
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Job</div>
          <div className="mt-3 space-y-2">
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Assigned employee</div>
              <div className="mt-1 font-bold">{job.contract_employee_name || `Employee #${job.contract_employee_id}`}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-black/60">{isLocked ? "Final agreed price" : "Current offer"}</div>
                  <div className="mt-1 font-bold tabular-nums">{agreedPrice != null ? formatMoney(agreedPrice) : "—"}</div>
                  {!isLocked ? (
                    <div className="mt-1 text-[11px] text-black/55">
                      {needsBoth
                        ? `Negotiation occurred — Admin: ${adminAccepted ? "accepted" : "pending"}, Employee: ${empAccepted ? "accepted" : "pending"}.`
                        : lastBy === "contract_employee"
                          ? "Waiting for Admin acceptance."
                          : lastBy === "admin"
                            ? "Waiting for Employee acceptance."
                            : "Waiting for acceptance."}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canAdminAccept ? (
                    <Button
                      onClick={() => {
                        void contractJobsApi
                          .adminAcceptOffer(job.id)
                          .then((j) => setJob(j))
                          .then(() => toast.push("success", "Offer accepted."))
                          .catch((e) => toast.push("error", getErrorMessage(e)));
                      }}
                    >
                      Accept offer
                    </Button>
                  ) : null}
                  {!isLocked && job.status !== "cancelled" ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const raw = prompt("Set offer (NGN)") || "";
                        if (!raw.trim()) return;
                        if (raw.trim() && !isValidThousandsCommaNumber(raw)) {
                          toast.push("error", "Fix comma formatting in amount.");
                          return;
                        }
                        const amt = parseMoneyInput(raw);
                        if (amt === null || Number.isNaN(amt) || amt <= 0) {
                          toast.push("error", "Enter a valid amount (> 0).");
                          return;
                        }
                        void contractJobsApi
                          .adminSetOffer(job.id, { price_offer: amt })
                          .then((j) => setJob(j))
                          .then(() => toast.push("success", "Offer updated."))
                          .catch((e) => toast.push("error", getErrorMessage(e)));
                      }}
                    >
                      Renegotiate
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="shrink-0">
                <JobStatusBadge status={job.status} />
              </div>
              <div className="shrink-0">
                <PaidFlagBadge paid={Boolean(job.paid_flag)} />
              </div>
            </div>
          </div>
        </Card>

        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Image preview</div>
          {job.image_url ? (
            <a href={job.image_url} target="_blank" rel="noreferrer" className="block">
              <img
                src={job.image_url}
                alt={`Job #${job.id}`}
                className="mt-3 w-full max-h-[360px] rounded-2xl border border-black/10 object-contain bg-white"
                loading="lazy"
              />
              <div className="mt-2 text-xs font-semibold text-black/60 underline decoration-black/20">Open full image</div>
            </a>
          ) : (
            <div className="mt-3 text-sm text-black/60">No image uploaded.</div>
          )}
        </Card>
      </div>

      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">Description</div>
        <div className="mt-2 whitespace-pre-wrap text-sm text-black/80">{(job.description || "").trim() || "—"}</div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Timeline</div>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <TimelineRow label="Created" value={job.created_at} />
            <TimelineRow label="Accepted" value={job.price_accepted_at ?? null} />
            <TimelineRow label="Started" value={job.started_at ?? null} />
            <TimelineRow label="Completed" value={job.completed_at ?? null} />
            <TimelineRow label="Paid" value={firstPaidAt} />
          </div>
          {job.paid_flag && !firstPaidAt ? (
            <div className="mt-2 text-xs text-black/50">Paid flag is set, but no paid payment transaction is linked.</div>
          ) : null}
        </Card>

        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Linked payments</div>
          {paymentTxns.length === 0 ? (
            <div className="mt-3 text-sm text-black/60">No linked payments.</div>
          ) : (
            <ul className="mt-3 space-y-2">
              {paymentTxns.map((t) => (
                <li key={t.id} className="rounded-2xl border border-black/10 bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">Payment #{t.id}</div>
                    <div className="text-xs font-semibold text-black/60">{t.status.toUpperCase()}</div>
                  </div>
                  <div className="mt-1 text-xs text-black/60">
                    Amount: <span className="font-semibold tabular-nums text-black">{formatMoney(t.amount)}</span>
                    {t.paid_at ? (
                      <>
                        {" "}
                        • Paid at: <span className="font-semibold text-black">{new Date(t.paid_at).toLocaleString()}</span>
                      </>
                    ) : null}
                  </div>
                  {t.receipt_url ? (
                    <div className="mt-2">
                      <a
                        className="text-xs font-semibold underline decoration-black/30"
                        href={t.receipt_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View receipt
                      </a>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

