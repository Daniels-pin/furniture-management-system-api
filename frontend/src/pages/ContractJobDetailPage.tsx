import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { contractJobsApi, notificationsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import type { ContractJob, NotificationItem } from "../types/api";
import { formatMoney } from "../utils/money";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";
import { usePageHeader } from "../components/layout/pageHeader";

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

function TimelineRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 text-sm">
      <div className="text-xs font-semibold text-black/60">{label}</div>
      <div className="font-semibold tabular-nums">{value ? new Date(value).toLocaleString() : "—"}</div>
    </div>
  );
}

export function ContractJobDetailPage() {
  const toast = useToast();
  const nav = useNavigate();
  const { jobId } = useParams();
  const id = Number(jobId);

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<ContractJob | null>(null);

  const [renegotiateOpen, setRenegotiateOpen] = useState(false);
  const [renegotiatePrice, setRenegotiatePrice] = useState("");
  const [renegotiating, setRenegotiating] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState("");
  const [cancelling, setCancelling] = useState(false);

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

  useEffect(() => {
    if (!job) return;
    let alive = true;
    (async () => {
      try {
        const res = await notificationsApi.my({ unread_only: true, limit: 200 });
        if (!alive) return;
        const items = Array.isArray(res?.items) ? (res.items as NotificationItem[]) : [];
        const related = items.filter((n) => n.entity_type === "contract_job" && Number(n.entity_id) === Number(job.id));
        await Promise.all(related.map((n) => notificationsApi.markRead(n.id)));
        if (related.length) window.dispatchEvent(new Event("furniture:notifications-updated"));
      } catch {
        // ignore (non-critical)
      }
    })();
    return () => {
      alive = false;
    };
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  usePageHeader({
    title: job ? `Job #${job.id}` : "Job",
    subtitle: "Job details."
  });

  const agreedPrice = job?.final_price != null ? job.final_price : job?.price_offer != null ? job.price_offer : null;
  const isLocked = Boolean(job?.price_accepted_at) || job?.final_price != null;
  const adminAccepted = Boolean(job?.admin_accepted_at);
  const empAccepted = Boolean(job?.employee_accepted_at);
  const needsBoth = Boolean(job?.negotiation_occurred);
  const lastBy = (job?.last_offer_by_role ?? null) as any;

  const negotiationState = useMemo(() => {
    if (!job) return { show: false, cls: "", headline: "", hint: "" };
    if (job.status === "cancelled" || isLocked) return { show: false, cls: "", headline: "", hint: "" };
    if (job.price_offer == null) {
      return {
        show: true,
        cls: "bg-black/[0.02] border-black/10",
        headline: "No price set yet",
        hint: "Propose a price to begin acceptance."
      };
    }
    if (needsBoth) {
      if (adminAccepted && !empAccepted) {
        return {
          show: true,
          cls: "bg-emerald-50 border-emerald-200",
          headline: "Other party has accepted this offer",
          hint: "Awaiting your confirmation."
        };
      }
      if (!adminAccepted && empAccepted) {
        return {
          show: true,
          cls: "bg-black/[0.02] border-black/10",
          headline: "You accepted this offer",
          hint: "Awaiting admin confirmation."
        };
      }
      return {
        show: true,
        cls: "bg-yellow-50 border-yellow-200",
        headline: "Negotiating",
        hint: `Admin: ${adminAccepted ? "accepted" : "pending"} • You: ${empAccepted ? "accepted" : "pending"}`
      };
    }
    // No negotiation occurred: only counter-party acceptance needed.
    if (lastBy === "admin") {
      return {
        show: true,
        cls: adminAccepted || empAccepted ? "bg-emerald-50 border-emerald-200" : "bg-black/[0.02] border-black/10",
        headline: adminAccepted ? "Other party has accepted this offer" : "Offer pending",
        hint: adminAccepted ? "Awaiting your confirmation." : "Review and accept, or renegotiate."
      };
    }
    if (lastBy === "contract_employee") {
      return {
        show: true,
        cls: empAccepted ? "bg-black/[0.02] border-black/10" : "bg-black/[0.02] border-black/10",
        headline: empAccepted ? "You proposed this offer" : "You proposed this offer",
        hint: "Awaiting admin acceptance (or renegotiate)."
      };
    }
    return { show: true, cls: "bg-yellow-50 border-yellow-200", headline: "Negotiating", hint: "Awaiting acceptance." };
  }, [job, isLocked, needsBoth, adminAccepted, empAccepted, lastBy]);

  const canAccept =
    Boolean(job) &&
    job.status === "pending" &&
    !isLocked &&
    job.price_offer != null &&
    (needsBoth ? !empAccepted : lastBy === "admin" && !empAccepted);

  const canStart = Boolean(job) && job.status === "pending" && isLocked;
  const canComplete = Boolean(job) && job.status === "in_progress";
  const canRenegotiate = Boolean(job) && job.status !== "cancelled" && !isLocked;
  const canCancel = Boolean(job) && job.status !== "cancelled";

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
          <Link className="text-sm font-semibold underline decoration-black/30" to="/contract?tab=jobs">
            ← Back to Jobs
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-black/60">
          <Link className="font-semibold underline decoration-black/30" to="/contract?tab=jobs">
            ← Jobs
          </Link>
        </div>
        <Button variant="secondary" onClick={() => nav("/contract?tab=jobs")}>
          Back
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Job</div>
          <div className="mt-3 space-y-2">
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Price</div>
              <div className="mt-1 font-bold tabular-nums">{agreedPrice != null ? formatMoney(agreedPrice) : "—"}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <JobStatusBadge status={job.status} />
              </div>
            </div>

            {negotiationState.show ? (
              <div className={["rounded-xl border p-3", negotiationState.cls].join(" ")}>
                <div className="text-xs font-semibold text-black/70">{negotiationState.headline}</div>
                <div className="mt-1 text-xs text-black/60">{negotiationState.hint}</div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {canAccept ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void contractJobsApi
                      .acceptPrice(job.id)
                      .then((j) => setJob(j))
                      .then(() => toast.push("success", "Offer accepted."))
                      .catch((e) => toast.push("error", getErrorMessage(e)));
                  }}
                >
                  Accept offer
                </Button>
              ) : null}
              {canRenegotiate ? (
                <Button
                  onClick={() => {
                    setRenegotiatePrice("");
                    setRenegotiateOpen(true);
                  }}
                >
                  Renegotiate price
                </Button>
              ) : null}
              {canStart ? (
                <Button
                  onClick={() => {
                    void contractJobsApi
                      .start(job.id)
                      .then((j) => setJob(j))
                      .then(() => toast.push("success", "Job started."))
                      .catch((e) => toast.push("error", getErrorMessage(e)));
                  }}
                >
                  Start
                </Button>
              ) : null}
              {canComplete ? (
                <Button
                  onClick={() => {
                    void contractJobsApi
                      .complete(job.id)
                      .then((j) => setJob(j))
                      .then(() => toast.push("success", "Job completed."))
                      .catch((e) => toast.push("error", getErrorMessage(e)));
                  }}
                >
                  Complete
                </Button>
              ) : null}
              {canCancel ? (
                <Button variant="danger" onClick={() => setCancelOpen(true)}>
                  Cancel
                </Button>
              ) : null}
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

      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">Timeline</div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          <TimelineRow label="Created" value={job.created_at} />
          <TimelineRow label="Accepted" value={job.price_accepted_at ?? null} />
          <TimelineRow label="Started" value={job.started_at ?? null} />
          <TimelineRow label="Completed" value={job.completed_at ?? null} />
          <TimelineRow label="Paid" value={job.paid_flag ? job.completed_at ?? null : null} />
        </div>
        <div className="mt-2 text-xs text-black/50">Payment status is a placeholder for now (paid flag only).</div>
      </Card>

      <Modal open={renegotiateOpen} title={`Renegotiate price (Job #${job.id})`} onClose={() => (renegotiating ? null : setRenegotiateOpen(false))}>
        <div className="space-y-3">
          <div className="text-sm text-black/70">Enter a new proposed price.</div>
          <Input
            label="New proposed price (NGN)"
            value={renegotiatePrice}
            onChange={(e) => setRenegotiatePrice(e.target.value)}
            inputMode="decimal"
            placeholder="0"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={renegotiating} onClick={() => setRenegotiateOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={renegotiating}
              onClick={() => {
                if (renegotiatePrice.trim() && !isValidThousandsCommaNumber(renegotiatePrice)) {
                  toast.push("error", "Fix comma formatting in amount.");
                  return;
                }
                const amt = parseMoneyInput(renegotiatePrice);
                if (amt === null || Number.isNaN(amt) || amt <= 0) {
                  toast.push("error", "Enter a valid amount (> 0).");
                  return;
                }
                setRenegotiating(true);
                void contractJobsApi
                  .setPrice(job.id, { price_offer: amt })
                  .then((j) => setJob(j))
                  .then(() => toast.push("success", "New price sent to admin."))
                  .then(() => setRenegotiateOpen(false))
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setRenegotiating(false));
              }}
            >
              Submit
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={cancelOpen} title={`Cancel job (Job #${job.id})`} onClose={() => (cancelling ? null : setCancelOpen(false))}>
        <div className="space-y-3">
          <div className="text-sm text-black/70">Provide a cancellation reason (required). This will notify the admin.</div>
          <Input label="Reason" value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} placeholder="Reason…" />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={cancelling} onClick={() => setCancelOpen(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              isLoading={cancelling}
              onClick={() => {
                if (!cancelNote.trim()) {
                  toast.push("error", "Reason is required.");
                  return;
                }
                setCancelling(true);
                void contractJobsApi
                  .cancel(job.id, { note: cancelNote.trim() })
                  .then((j) => setJob(j))
                  .then(() => toast.push("success", "Job cancelled."))
                  .then(() => setCancelOpen(false))
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setCancelling(false));
              }}
            >
              Confirm cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

