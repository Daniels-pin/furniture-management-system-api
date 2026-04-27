import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { contractEmployeePortalApi, contractJobsApi, notificationsApi } from "../services/endpoints";
import { authApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import type { ContractEmployeeMe, ContractJob, EmployeeTransaction } from "../types/api";
import { formatMoney } from "../utils/money";
import { usePageHeader } from "../components/layout/pageHeader";
import { Modal } from "../components/ui/Modal";
import { Input } from "../components/ui/Input";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";
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

function ContractJobCard({
  job,
  highlight,
  onOpen,
  actions
}: {
  job: ContractJob;
  highlight: boolean;
  onOpen(): void;
  actions: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={[
        "w-full rounded-2xl border border-black/10 bg-white p-4 text-left shadow-soft transition",
        highlight ? "bg-blue-50/60" : "",
        "active:scale-[0.99]"
      ].join(" ")}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-bold">Job #{job.id}</div>
            <JobStatusBadge status={job.status} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2">
              <div className="font-semibold text-black/55">Price</div>
              <div className="mt-0.5 text-sm font-bold tabular-nums text-black">
                {job.final_price ? formatMoney(job.final_price) : job.price_offer ? formatMoney(job.price_offer) : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2">
              <div className="font-semibold text-black/55">Balance</div>
              <div className="mt-0.5 text-sm font-bold tabular-nums text-black">
                {typeof job.balance !== "undefined" && job.balance !== null ? formatMoney(job.balance) : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2">
              <div className="font-semibold text-black/55">Paid</div>
              <div className="mt-0.5 text-sm font-bold tabular-nums text-black">{formatMoney(job.amount_paid ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2">
              <div className="font-semibold text-black/55">Created</div>
              <div className="mt-0.5 text-[13px] font-semibold text-black">{new Date(job.created_at).toLocaleDateString()}</div>
            </div>
          </div>
        </div>
        <div className="shrink-0 text-xs font-semibold text-black/45">Tap to open</div>
      </div>

      <div className="mt-4" onClick={(e) => e.stopPropagation()}>
        <div className="grid grid-cols-1 gap-2">{actions}</div>
      </div>
    </button>
  );
}

export function ContractEmployeeDashboardPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [me, setMe] = useState<ContractEmployeeMe | null>(null);
  const [jobs, setJobs] = useState<ContractJob[]>([]);
  const [txns, setTxns] = useState<EmployeeTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const initialTab = (searchParams.get("tab") || "summary") as
    | "summary"
    | "jobs"
    | "new"
    | "request"
    | "profile"
    | "password";
  const [tab, setTab] = useState<"summary" | "jobs" | "new" | "request" | "profile" | "password">(
    initialTab && ["summary", "jobs", "new", "request", "profile", "password"].includes(initialTab) ? initialTab : "summary"
  );

  const [profileBusy, setProfileBusy] = useState(false);
  const [profileDraft, setProfileDraft] = useState({
    full_name: "",
    bank_name: "",
    account_number: "",
    phone: "",
    address: ""
  });

  const [newDesc, setNewDesc] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [newPriceOffer, setNewPriceOffer] = useState("");
  const [creating, setCreating] = useState(false);
  const [reqAmt, setReqAmt] = useState("");
  const [reqNote, setReqNote] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderItems, setReminderItems] = useState<Array<{ id: number; completed_at?: string | null; final_price?: string | null }>>([]);
  const [reminderBusy, setReminderBusy] = useState(false);

  const [pwBusy, setPwBusy] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const [renegotiateOpen, setRenegotiateOpen] = useState(false);
  const [renegotiateTarget, setRenegotiateTarget] = useState<ContractJob | null>(null);
  const [renegotiatePrice, setRenegotiatePrice] = useState("");
  const [renegotiating, setRenegotiating] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ContractJob | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [highlightJobIds, setHighlightJobIds] = useState<number[]>([]);

  usePageHeader({
    title: "Contract Dashboard",
    subtitle: "Your jobs and payment summary."
  });

  function setTabAndSync(next: typeof tab) {
    setTab(next);
    const sp = new URLSearchParams(searchParams);
    sp.set("tab", next);
    setSearchParams(sp, { replace: true });
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const m = await contractEmployeePortalApi.me();
        const needsPasswordChange = Boolean((m as any)?.needs_password_change);
        const needsProfileCompletion = Boolean(m?.needs_profile_completion);
        const canLoadJobs = !needsPasswordChange && !needsProfileCompletion;
        const [j, t] = canLoadJobs
          ? await Promise.all([contractJobsApi.listMe(), contractEmployeePortalApi.transactions()])
          : [[], [] as EmployeeTransaction[]];
        if (!alive) return;
        setMe(m);
        setJobs(j);
        setTxns(Array.isArray(t) ? t : []);
        setProfileDraft({
          full_name: m.full_name ?? "",
          bank_name: m.bank_name ?? "",
          account_number: m.account_number ?? "",
          phone: m.phone ?? "",
          address: m.address ?? ""
        });
        if (m.needs_profile_completion) setTabAndSync("profile");
        else if ((m as any).needs_password_change) setTabAndSync("password");
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!me || me.needs_profile_completion) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = `furniture_daily_paid_reminder_${me.id}`;
    const last = localStorage.getItem(key);
    if (last === today) return;
    let alive = true;
    (async () => {
      try {
        const res = await contractEmployeePortalApi.unpaidCompletedJobs();
        if (!alive) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        if (items.length > 0) {
          setReminderItems(items);
          setReminderOpen(true);
        }
        localStorage.setItem(key, today);
      } catch {
        // ignore (non-critical)
      }
    })();
    return () => {
      alive = false;
    };
  }, [me]);

  const mustCompleteProfile = Boolean(me?.needs_profile_completion);
  const mustChangePassword = Boolean((me as any)?.needs_password_change);
  const mustOnboard = mustCompleteProfile || mustChangePassword;

  const inProgress = useMemo(() => jobs.filter((j) => j.status === "in_progress"), [jobs]);
  const completed = useMemo(() => jobs.filter((j) => j.status === "completed"), [jobs]);
  const pendingRequests = useMemo(
    () =>
      (txns || []).filter(
        (t) =>
          t.txn_type === "payment" &&
          (t.status === "requested" || t.status === "approved_by_admin" || t.status === "sent_to_finance" || t.status === "pending")
      ),
    [txns]
  );
  const [financeUnreadCount, setFinanceUnreadCount] = useState(0);

  const FINANCE_KINDS = useMemo(
    () =>
      new Set([
        "job_cancelled",
        "price_updated",
        "price_accepted",
        "payment_request_submitted",
        "payment_approved",
        "payment_sent_to_finance",
        "payment_completed"
      ]),
    []
  );

  useEffect(() => {
    if (loading) return;
    if (!me) return;
    let alive = true;
    async function refreshFinanceBadge() {
      try {
        const res = await notificationsApi.my({ unread_only: true, limit: 200 });
        if (!alive) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        const count = items.filter((n: any) => FINANCE_KINDS.has(String(n?.kind || ""))).length;
        setFinanceUnreadCount(count);
      } catch {
        if (!alive) return;
        setFinanceUnreadCount(0);
      }
    }

    const onUpdated = () => void refreshFinanceBadge();
    window.addEventListener("furniture:notifications-updated", onUpdated as any);
    void refreshFinanceBadge();
    return () => {
      alive = false;
      window.removeEventListener("furniture:notifications-updated", onUpdated as any);
    };
  }, [loading, me, FINANCE_KINDS]);

  useEffect(() => {
    if (loading) return;
    if (tab !== "jobs") return;
    let alive = true;
    (async () => {
      try {
        const res = await notificationsApi.my({ unread_only: true, limit: 200 });
        if (!alive) return;
        const ids = (Array.isArray(res?.items) ? res.items : [])
          .filter((n: any) => n?.kind === "job_assigned")
          .map((n: any) => Number(n?.entity_id))
          .filter((x: any) => Number.isFinite(x));
        setHighlightJobIds(Array.from(new Set(ids)));
        if (ids.length) {
          await notificationsApi.markJobAssignedRead();
          window.dispatchEvent(new Event("furniture:notifications-updated"));
        }
      } catch {
        // ignore (non-critical)
      }
    })();
    return () => {
      alive = false;
    };
  }, [loading, tab]);

  useEffect(() => {
    if (loading) return;
    if (tab !== "summary") return;
    let alive = true;
    (async () => {
      try {
        // Optimistically clear the badge immediately on open.
        setFinanceUnreadCount(0);
        await notificationsApi.markFinanceRead();
        if (!alive) return;
        window.dispatchEvent(new Event("furniture:notifications-updated"));
      } catch {
        // ignore (non-critical)
      }
    })();
    return () => {
      alive = false;
    };
  }, [loading, tab]);

  async function refresh() {
    const m = await contractEmployeePortalApi.me();
    const needsPasswordChange = Boolean((m as any)?.needs_password_change);
    const needsProfileCompletion = Boolean(m?.needs_profile_completion);
    const canLoadJobs = !needsPasswordChange && !needsProfileCompletion;
    const [j, t] = canLoadJobs
      ? await Promise.all([contractJobsApi.listMe(), contractEmployeePortalApi.transactions()])
      : [[], [] as EmployeeTransaction[]];
    setMe(m);
    setJobs(j);
    setTxns(Array.isArray(t) ? t : []);
    setProfileDraft({
      full_name: m.full_name ?? "",
      bank_name: m.bank_name ?? "",
      account_number: m.account_number ?? "",
      phone: m.phone ?? "",
      address: m.address ?? ""
    });
  }

  return (
    <div className="space-y-6">
      <div className="-mx-4 md:mx-0">
        <div
          className={[
            "overflow-x-auto overscroll-x-contain",
            "px-4 md:px-0",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          ].join(" ")}
        >
          <div className="inline-flex max-w-full rounded-2xl border border-black/10 bg-white p-1 whitespace-nowrap">
            {(
              [
                ["summary", "Financial Summary"],
                ["jobs", "Jobs"],
                ["new", "Start New Job"],
                ["request", "Request Payment"],
                ["profile", "Profile"],
                ["password", "Change Password"]
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  if (mustOnboard && k !== "profile" && k !== "password") return;
                  setTabAndSync(k);
                }}
                className={[
                  "shrink-0 min-h-10 rounded-xl px-3 text-sm font-semibold",
                  tab === k ? "bg-black text-white" : "text-black/70 hover:bg-black/5",
                  mustOnboard && k !== "profile" && k !== "password" ? "opacity-50 cursor-not-allowed" : ""
                ].join(" ")}
              >
                <span className="inline-flex items-center gap-2">
                  <span>{label}</span>
                  {k === "summary" && financeUnreadCount > 0 ? (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
                      {financeUnreadCount}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <Card>
          <div className="text-sm text-black/60">Loading…</div>
        </Card>
      ) : !me ? (
        <Card>
          <div className="text-sm text-black/60">Profile not found. Contact an admin.</div>
        </Card>
      ) : tab === "summary" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Total owed</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(me.total_owed)}</div>
          </Card>
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Total paid</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(me.total_paid)}</div>
          </Card>
          <Card className="!border-black !bg-black !p-4 text-white">
            <div className="text-xs font-semibold text-white/70">Balance</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(me.balance)}</div>
          </Card>
          <Card className="sm:col-span-3 !p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">Job preview</div>
              <Button variant="secondary" onClick={() => void refresh()}>
                Refresh
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-black/55">In progress</div>
                {(inProgress || []).length === 0 ? (
                  <div className="mt-2 text-sm text-black/60">No jobs in progress.</div>
                ) : (
                  <ul className="mt-2 divide-y divide-black/10 rounded-2xl border border-black/10">
                    {inProgress.slice(0, 5).map((j) => (
                      <li key={j.id} className="px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold">Job #{j.id}</div>
                          <JobStatusBadge status={j.status} />
                        </div>
                        <div className="mt-1 text-xs text-black/60">
                          Price: {j.final_price ? formatMoney(j.final_price) : j.price_offer ? formatMoney(j.price_offer) : "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-black/55">Completed</div>
                {(completed || []).length === 0 ? (
                  <div className="mt-2 text-sm text-black/60">No completed jobs yet.</div>
                ) : (
                  <ul className="mt-2 divide-y divide-black/10 rounded-2xl border border-black/10">
                    {completed.slice(0, 5).map((j) => (
                      <li key={j.id} className="px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold">Job #{j.id}</div>
                          <JobStatusBadge status={j.status} />
                        </div>
                        <div className="mt-1 text-xs text-black/60">
                          Price: {j.final_price ? formatMoney(j.final_price) : "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>

          <Card className="sm:col-span-3 !p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">Financial Activity</div>
              <Button variant="secondary" onClick={() => void refresh()}>
                Refresh
              </Button>
            </div>

            {pendingRequests.length ? (
              <div className="mt-3 rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-950">
                <div className="font-semibold">Pending</div>
                <div className="mt-1 text-xs text-yellow-900">
                  {pendingRequests
                    .map((t) => `#${t.id} (${getFinancialActivityStatusLabel(t)})`)
                    .slice(0, 4)
                    .join(" • ")}
                  {pendingRequests.length > 4 ? " • …" : ""}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-black/60">No pending requests.</div>
            )}

            {txns.length === 0 ? (
              <div className="mt-3 text-sm text-black/60">No financial activity yet.</div>
            ) : (
              <ul className="mt-3 divide-y divide-black/10 rounded-2xl border border-black/10">
                {txns.slice(0, 12).map((t) => {
                  const color = getFinancialActivityColor(t);
                  const cls = getFinancialActivityClasses(color);
                  const typeLabel = getFinancialActivityTypeLabel(t);
                  const statusLabel = getFinancialActivityStatusLabel(t);
                  const relatedJob =
                    typeof (t as any)?.contract_job_id !== "undefined" && (t as any)?.contract_job_id !== null
                      ? `Job #${Number((t as any).contract_job_id)}`
                      : Array.isArray((t as any)?.allocations) && (t as any).allocations.length
                        ? `Jobs: ${(t as any).allocations
                            .slice(0, 3)
                            .map((a: any) => `#${Number(a.contract_job_id)}`)
                            .join(", ")}${(t as any).allocations.length > 3 ? "…" : ""}`
                        : null;

                  return (
                    <li key={t.id} className={["px-4 py-3 text-sm", cls.bg, cls.text].join(" ")}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-semibold">{typeLabel}</div>
                            <span
                              className={[
                                "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
                                cls.ring
                              ].join(" ")}
                            >
                              {statusLabel}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-black/60">
                            {new Date(t.created_at).toLocaleString()}
                            {relatedJob ? ` • ${relatedJob}` : ""}
                          </div>
                          {t.note ? <div className="mt-1 text-xs text-black/60">{t.note}</div> : null}
                        </div>
                        <div className="shrink-0 font-bold tabular-nums">{formatMoney(t.amount)}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      ) : tab === "jobs" ? (
        <Card className="!p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="text-sm font-semibold">Jobs</div>
            <Button variant="secondary" onClick={() => void refresh()}>
              Refresh
            </Button>
          </div>
          {jobs.length === 0 ? (
            <div className="mt-3 text-sm text-black/60">No jobs yet.</div>
          ) : (
            <>
              {/* Mobile: cards to avoid horizontal scrolling + cramped row actions */}
              <div className="mt-3 space-y-3 md:hidden">
                {jobs.map((j) => {
                  const needsBoth = Boolean((j as any).negotiation_occurred);
                  const lastBy = ((j as any).last_offer_by_role ?? null) as any;
                  const empAccepted = Boolean((j as any).employee_accepted_at);
                  const canAccept = j.status === "pending" && !j.price_accepted_at && j.price_offer != null && (needsBoth ? !empAccepted : lastBy === "admin");
                  const waitingForAdmin = j.status === "pending" && !j.price_accepted_at && j.price_offer != null && !canAccept;
                  const canRenegotiate = j.status !== "cancelled" && !j.price_accepted_at;
                  const canStart = j.status === "pending" && Boolean(j.price_accepted_at);
                  const canComplete = j.status === "in_progress";
                  const canCancel = j.status !== "cancelled";

                  return (
                    <ContractJobCard
                      key={j.id}
                      job={j}
                      highlight={highlightJobIds.includes(j.id)}
                      onOpen={() => nav(`/contract/jobs/${j.id}`)}
                      actions={
                        <>
                          <Button variant="secondary" className="w-full" onClick={() => nav(`/contract/jobs/${j.id}`)}>
                            View details
                          </Button>
                          {canAccept ? (
                            <Button
                              variant="secondary"
                              className="w-full"
                              onClick={() => {
                                void contractJobsApi
                                  .acceptPrice(j.id)
                                  .then(() => refresh())
                                  .then(() => toast.push("success", "Offer accepted."))
                                  .catch((e) => toast.push("error", getErrorMessage(e)));
                              }}
                            >
                              Accept offer
                            </Button>
                          ) : waitingForAdmin ? (
                            <Button variant="secondary" className="w-full" disabled>
                              Waiting for admin
                            </Button>
                          ) : null}
                          {canRenegotiate ? (
                            <Button
                              className="w-full"
                              onClick={() => {
                                setRenegotiateTarget(j);
                                setRenegotiatePrice("");
                                setRenegotiateOpen(true);
                              }}
                            >
                              Renegotiate price
                            </Button>
                          ) : null}
                          {canStart ? (
                            <Button
                              className="w-full"
                              onClick={() => {
                                void contractJobsApi
                                  .start(j.id)
                                  .then(() => refresh())
                                  .then(() => toast.push("success", "Job started."))
                                  .catch((e) => toast.push("error", getErrorMessage(e)));
                              }}
                            >
                              Start
                            </Button>
                          ) : null}
                          {canComplete ? (
                            <Button
                              className="w-full"
                              onClick={() => {
                                void contractJobsApi
                                  .complete(j.id)
                                  .then(() => refresh())
                                  .then(() => toast.push("success", "Job completed."))
                                  .catch((e) => toast.push("error", getErrorMessage(e)));
                              }}
                            >
                              Complete
                            </Button>
                          ) : null}
                          {canCancel ? (
                            <Button
                              variant="danger"
                              className="w-full"
                              onClick={() => {
                                setCancelTarget(j);
                                setCancelNote("");
                                setCancelOpen(true);
                              }}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </>
                      }
                    />
                  );
                })}
              </div>

              {/* Desktop: preserve existing table layout */}
              <div className="mt-3 hidden min-w-0 overflow-x-touch md:block">
                <table className="w-full min-w-[920px] text-left text-sm">
                  <thead className="text-black/60">
                    <tr className="border-b border-black/10">
                      <th className="py-3 pr-4 font-semibold">Job</th>
                      <th className="py-3 pr-4 font-semibold">Status</th>
                      <th className="py-3 pr-4 text-right font-semibold">Price</th>
                      <th className="py-3 pr-4 text-right font-semibold">Paid</th>
                      <th className="py-3 pr-4 text-right font-semibold">Balance</th>
                      <th className="py-3 pr-4 font-semibold">Timeline</th>
                      <th className="py-3 pr-0 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr
                        key={j.id}
                        className={[
                          "border-b border-black/5",
                          highlightJobIds.includes(j.id) ? "bg-blue-50/60" : "",
                          "cursor-pointer hover:bg-black/[0.02]"
                        ].join(" ")}
                        onClick={() => nav(`/contract/jobs/${j.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") nav(`/contract/jobs/${j.id}`);
                        }}
                      >
                        <td className="py-3 pr-4 font-semibold">#{j.id}</td>
                        <td className="py-3 pr-4">
                          <JobStatusBadge status={j.status} />
                        </td>
                        <td className="py-3 pr-4 text-right font-bold tabular-nums">
                          {j.final_price ? formatMoney(j.final_price) : j.price_offer ? formatMoney(j.price_offer) : "—"}
                        </td>
                        <td className="py-3 pr-4 text-right font-bold tabular-nums">{formatMoney(j.amount_paid ?? 0)}</td>
                        <td className="py-3 pr-4 text-right font-bold tabular-nums">
                          {typeof j.balance !== "undefined" && j.balance !== null ? formatMoney(j.balance) : "—"}
                        </td>
                        <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                          Created: {new Date(j.created_at).toLocaleString()}
                          {j.price_accepted_at ? ` • Accepted: ${new Date(j.price_accepted_at).toLocaleString()}` : ""}
                          {j.started_at ? ` • Started: ${new Date(j.started_at).toLocaleString()}` : ""}
                          {j.completed_at ? ` • Completed: ${new Date(j.completed_at).toLocaleString()}` : ""}
                          {j.paid_flag ? " • Paid" : ""}
                        </td>
                        <td className="py-3 pr-0 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-2">
                            {j.status === "pending" && !j.price_accepted_at ? (
                              <>
                                {(() => {
                                  const needsBoth = Boolean((j as any).negotiation_occurred);
                                  const lastBy = ((j as any).last_offer_by_role ?? null) as any;
                                  const empAccepted = Boolean((j as any).employee_accepted_at);
                                  const canAccept = needsBoth ? !empAccepted : lastBy === "admin";
                                  return canAccept ? (
                                    <Button
                                      variant="secondary"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void contractJobsApi
                                          .acceptPrice(j.id)
                                          .then(() => refresh())
                                          .then(() => toast.push("success", "Offer accepted."))
                                          .catch((e) => toast.push("error", getErrorMessage(e)));
                                      }}
                                    >
                                      Accept offer
                                    </Button>
                                  ) : (
                                    <Button variant="secondary" disabled>
                                      Waiting for admin
                                    </Button>
                                  );
                                })()}
                                <Button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRenegotiateTarget(j);
                                    setRenegotiatePrice("");
                                    setRenegotiateOpen(true);
                                  }}
                                >
                                  Renegotiate price
                                </Button>
                              </>
                            ) : null}
                            {j.status === "pending" && j.price_accepted_at ? (
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void contractJobsApi
                                    .start(j.id)
                                    .then(() => refresh())
                                    .then(() => toast.push("success", "Job started."))
                                    .catch((e) => toast.push("error", getErrorMessage(e)));
                                }}
                              >
                                Start
                              </Button>
                            ) : null}
                            {j.status === "in_progress" ? (
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void contractJobsApi
                                    .complete(j.id)
                                    .then(() => refresh())
                                    .then(() => toast.push("success", "Job completed."))
                                    .catch((e) => toast.push("error", getErrorMessage(e)));
                                }}
                              >
                                Complete
                              </Button>
                            ) : null}
                            {j.status !== "cancelled" ? (
                              <Button
                                variant="danger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCancelTarget(j);
                                  setCancelNote("");
                                  setCancelOpen(true);
                                }}
                              >
                                Cancel
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : tab === "new" ? (
        <Card className="!p-4">
          <div className="text-sm font-semibold">Start new job</div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-black/60 sm:col-span-2">
              Description <span className="text-red-600">*</span>
              <textarea
                className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold min-h-[88px]"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Describe the work clearly…"
              />
            </label>
            <label className="text-xs font-semibold text-black/60">
              Image (optional)
              <input
                className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                type="file"
                accept="image/*"
                onChange={(e) => setNewImageFile((e.target.files && e.target.files[0]) || null)}
              />
              <div className="mt-1 text-[11px] text-black/50">Uploads to Cloudinary.</div>
            </label>
            <Input
              label="Or paste Image URL (optional)"
              value={newImageUrl}
              onChange={(e) => setNewImageUrl(e.target.value)}
              placeholder="https://res.cloudinary.com/…"
            />
            <Input
              label="Price (NGN)"
              value={newPriceOffer}
              onChange={(e) => setNewPriceOffer(e.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </div>
          <div className="mt-3">
            <Button
              isLoading={creating}
              onClick={() => {
                if (!newDesc.trim()) {
                  toast.push("error", "Description is required.");
                  return;
                }
                if (newPriceOffer.trim() && !isValidThousandsCommaNumber(newPriceOffer)) {
                  toast.push("error", "Fix comma formatting in amount.");
                  return;
                }
                const amt = newPriceOffer.trim() ? parseMoneyInput(newPriceOffer) : null;
                if (newPriceOffer.trim() && (amt === null || Number.isNaN(amt) || amt <= 0)) {
                  toast.push("error", "Enter a valid price (> 0) or leave it blank.");
                  return;
                }
                setCreating(true);
                void (async () => {
                  let imageUrl: string | null | undefined = newImageUrl.trim() || null;
                  if (newImageFile) {
                    const up = await contractJobsApi.uploadImage(newImageFile);
                    imageUrl = up.image_url;
                  }
                  await contractJobsApi.createMe({
                    description: newDesc.trim(),
                    image_url: imageUrl || undefined,
                    price_offer: amt ?? undefined
                  });
                })()
                  .then(() => refresh())
                  .then(() => {
                    setNewDesc("");
                    setNewImageUrl("");
                    setNewImageFile(null);
                    setNewPriceOffer("");
                    toast.push("success", "Job created.");
                    setTabAndSync("jobs");
                  })
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setCreating(false));
              }}
            >
              Create job
            </Button>
          </div>
          <div className="mt-2 text-xs text-black/50">
            Description is required. Price and image are optional.
          </div>
        </Card>
      ) : tab === "request" ? (
        <Card className="!p-4">
          <div className="text-sm font-semibold">Request payment</div>
          <div className="mt-2 text-sm text-black/60">This creates a request for Admin approval. Finance will only see it after Admin sends it to Finance.</div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Amount (NGN)"
              value={reqAmt}
              onChange={(e) => setReqAmt(e.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
            <Input label="Note (optional)" value={reqNote} onChange={(e) => setReqNote(e.target.value)} />
          </div>
          <div className="mt-3">
            <Button
              isLoading={requesting}
              onClick={() => {
                if (reqAmt.trim() && !isValidThousandsCommaNumber(reqAmt)) {
                  toast.push("error", "Fix comma formatting in amount.");
                  return;
                }
                const amt = parseMoneyInput(reqAmt);
                if (amt === null || Number.isNaN(amt) || amt <= 0) {
                  toast.push("error", "Enter a valid amount (> 0).");
                  return;
                }
                setRequesting(true);
                void contractEmployeePortalApi
                  .requestPayment({ amount: amt, note: reqNote.trim() || null })
                  .then(() => toast.push("success", "Payment request sent."))
                  .then(() => {
                    setReqAmt("");
                    setReqNote("");
                  })
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setRequesting(false));
              }}
            >
              Send request
            </Button>
          </div>
        </Card>
      ) : tab === "password" ? (
        <Card className="!p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Change password</div>
              {mustChangePassword ? (
                <div className="mt-1 text-xs font-semibold text-amber-900">
                  You must change your password before using the dashboard.
                </div>
              ) : (
                <div className="mt-1 text-xs text-black/55">Update your password anytime.</div>
              )}
            </div>
            <Button
              variant="secondary"
              isLoading={pwBusy}
              onClick={() => {
                if (newPw.trim().length < 8) {
                  toast.push("error", "New password must be at least 8 characters.");
                  return;
                }
                if (newPw !== confirmPw) {
                  toast.push("error", "New passwords do not match.");
                  return;
                }
                setPwBusy(true);
                void authApi
                  .changePassword({
                    current_password: currentPw,
                    new_password: newPw,
                    confirm_password: confirmPw
                  })
                  .then(() => contractEmployeePortalApi.me())
                  .then((m) => setMe(m))
                  .then(() => {
                    setCurrentPw("");
                    setNewPw("");
                    setConfirmPw("");
                    toast.push("success", "Password updated.");
                    if (!mustCompleteProfile) setTabAndSync("summary");
                  })
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setPwBusy(false));
              }}
            >
              Save
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Current password" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
            <div />
            <Input label="New password" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <Input label="Confirm new password" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          </div>
        </Card>
      ) : (
        <Card className="!p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Profile</div>
              {mustCompleteProfile ? (
                <div className="mt-1 text-xs font-semibold text-amber-900">
                  Complete your profile to access jobs and finances.
                </div>
              ) : (
                <div className="mt-1 text-xs text-black/55">You can edit your profile anytime.</div>
              )}
            </div>
            <Button
              variant="secondary"
              isLoading={profileBusy}
              disabled={profileBusy}
              onClick={() => {
                if (!profileDraft.full_name.trim()) {
                  toast.push("error", "Name is required.");
                  return;
                }
                if (!profileDraft.bank_name.trim()) {
                  toast.push("error", "Bank name is required.");
                  return;
                }
                if (!profileDraft.account_number.trim()) {
                  toast.push("error", "Account number is required.");
                  return;
                }
                if (!/^\d+$/.test(profileDraft.account_number.trim())) {
                  toast.push("error", "Account number must contain digits only.");
                  return;
                }
                setProfileBusy(true);
                const payload = {
                  full_name: profileDraft.full_name.trim() || null,
                  bank_name: profileDraft.bank_name.trim() || null,
                  account_number: profileDraft.account_number.trim() || null,
                  phone: profileDraft.phone.trim() || null,
                  address: profileDraft.address.trim() || null
                };
                console.log("[contract-employee.patchMe] payload", payload);
                void contractEmployeePortalApi
                  .patchMe(payload)
                  .then((m) => {
                    console.log("[contract-employee.patchMe] response", m);
                    setMe(m);
                  })
                  .then(() => toast.push("success", "Profile updated."))
                  .catch((e) => {
                    console.error("[contract-employee.patchMe] error", e);
                    toast.push("error", getErrorMessage(e));
                  })
                  .finally(() => setProfileBusy(false));
              }}
            >
              Save
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Name" value={profileDraft.full_name} onChange={(e) => setProfileDraft((p) => ({ ...p, full_name: e.target.value }))} />
            <Input label="Bank name" value={profileDraft.bank_name} onChange={(e) => setProfileDraft((p) => ({ ...p, bank_name: e.target.value }))} />
            <Input
              label="Account number"
              value={profileDraft.account_number}
              onChange={(e) => setProfileDraft((p) => ({ ...p, account_number: e.target.value }))}
            />
            <Input label="Phone" value={profileDraft.phone} onChange={(e) => setProfileDraft((p) => ({ ...p, phone: e.target.value }))} />
            <div className="sm:col-span-2">
              <Input label="Address" value={profileDraft.address} onChange={(e) => setProfileDraft((p) => ({ ...p, address: e.target.value }))} />
            </div>
          </div>
        </Card>
      )}

      <Modal
        open={mustCompleteProfile && tab !== "profile"}
        title="Complete your profile"
        onClose={() => setTabAndSync("profile")}
      >
        <div className="space-y-3 text-sm text-black/70">
          <div>You must complete your profile before you can use the dashboard.</div>
          <div className="text-xs text-black/55">
            Required: Name, Bank name, Account number, Phone, Address.
          </div>
          <Button onClick={() => setTabAndSync("profile")}>Go to Profile</Button>
        </div>
      </Modal>

      <Modal
        open={mustChangePassword && !mustCompleteProfile && tab !== "password"}
        title="Change your password"
        onClose={() => setTabAndSync("password")}
      >
        <div className="space-y-3 text-sm text-black/70">
          <div>You must change your password before you can use the dashboard.</div>
          <Button onClick={() => setTabAndSync("password")}>Go to Change Password</Button>
        </div>
      </Modal>

      <Modal
        open={renegotiateOpen}
        title={renegotiateTarget ? `Renegotiate price (Job #${renegotiateTarget.id})` : "Renegotiate price"}
        onClose={() => (renegotiating ? null : setRenegotiateOpen(false))}
      >
        <div className="space-y-3">
          <div className="text-sm text-black/70">
            Enter a new proposed price. If negotiation occurs, both parties must accept the final offer before the job can start.
          </div>
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
                if (!renegotiateTarget) return;
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
                  .setPrice(renegotiateTarget.id, { price_offer: amt })
                  .then(() => refresh())
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

      <Modal open={cancelOpen} title={cancelTarget ? `Cancel job (Job #${cancelTarget.id})` : "Cancel job"} onClose={() => (cancelling ? null : setCancelOpen(false))}>
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
                if (!cancelTarget) return;
                if (!cancelNote.trim()) {
                  toast.push("error", "Reason is required.");
                  return;
                }
                setCancelling(true);
                void contractJobsApi
                  .cancel(cancelTarget.id, { note: cancelNote.trim() })
                  .then(() => refresh())
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

      <Modal open={reminderOpen} title="Daily payment reminder" onClose={() => setReminderOpen(false)}>
        <div className="space-y-3 text-sm text-black/70">
          <div className="font-semibold text-black">Has payment for these jobs been made?</div>
          {reminderItems.length === 0 ? (
            <div className="text-sm text-black/60">No unpaid completed jobs.</div>
          ) : (
            <ul className="divide-y divide-black/10 rounded-2xl border border-black/10">
              {reminderItems.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-semibold">Job #{j.id}</div>
                    <div className="text-xs text-black/60">
                      {j.completed_at ? `Completed: ${new Date(j.completed_at).toLocaleString()}` : "Completed"}
                      {j.final_price ? ` • Price: ${formatMoney(j.final_price)}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <Button
                      variant="secondary"
                      isLoading={reminderBusy}
                      onClick={() => {
                        setReminderBusy(true);
                        void contractJobsApi
                          .markPaidFlag(j.id)
                          .then(() => refresh())
                          .then(() => {
                            setReminderItems((prev) => prev.filter((x) => x.id !== j.id));
                            toast.push("success", `Marked Job #${j.id} as paid.`);
                          })
                          .catch((e) => toast.push("error", getErrorMessage(e)))
                          .finally(() => setReminderBusy(false));
                      }}
                    >
                      Yes
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setReminderOpen(false)}>
              No
            </Button>
          </div>
          <div className="text-xs text-black/55">
            Marking “Yes” only sets the job’s paid flag. It does not move money or affect totals.
          </div>
        </div>
      </Modal>
    </div>
  );
}

