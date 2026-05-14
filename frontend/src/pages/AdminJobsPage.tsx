import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { Input } from "../components/ui/Input";
import { contractEmployeesApi, contractJobsApi, notificationsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { formatMoney } from "../utils/money";
import type { AdminJobsSummary, ContractEmployeeListItem, ContractJob, NotificationItem } from "../types/api";
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

function NegotiationBadge({ state }: { state: "none" | "negotiating" | "accepted" }) {
  if (state === "none") return null;
  if (state === "accepted") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900 ring-1 ring-inset ring-emerald-200">
        Accepted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-semibold text-yellow-900 ring-1 ring-inset ring-yellow-200">
      Negotiating
    </span>
  );
}

function AcceptanceIndicator({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 ring-1 ring-inset ring-emerald-200">
      {label}
    </span>
  );
}

function firstNameFromFullName(fullName: string | null | undefined): string | null {
  const s = String(fullName || "").trim();
  if (!s) return null;
  const first = s.split(/\s+/)[0];
  return first || null;
}

function getNegotiationUi(j: ContractJob) {
  const needsBoth = Boolean((j as any).negotiation_occurred || (j as any).hasNegotiation);
  const adminAccepted = Boolean((j as any).admin_accepted_at || (j as any).adminAccepted);
  const empAccepted = Boolean((j as any).employee_accepted_at || (j as any).employeeAccepted);
  const hasOffer = Boolean(j.price_offer != null);

  // UI-only: show "Accepted" when both parties have accepted (even if the API has already locked the job via price_accepted_at).
  const bothAccepted = hasOffer && needsBoth && adminAccepted && empAccepted;
  const negotiating = hasOffer && needsBoth && !bothAccepted;
  const state: "none" | "negotiating" | "accepted" = bothAccepted ? "accepted" : negotiating ? "negotiating" : "none";

  const empFirst = firstNameFromFullName(j.contract_employee_name);
  const acceptanceLabel =
    state === "negotiating" && adminAccepted !== empAccepted
      ? adminAccepted
        ? "Accepted by Admin"
        : `Accepted by ${empFirst || "Employee"}`
      : null;

  const lastPriceByLabel =
    j.final_price != null
      ? null
      : j.price_offer != null
        ? (j.last_offer_by_role === "admin"
            ? "Admin"
            : j.last_offer_by_role === "contract_employee"
              ? empFirst || "Employee"
              : null)
        : null;

  return { state, acceptanceLabel, lastPriceByLabel };
}

function parseTimeMs(v?: string | null): number {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isNegotiationNotification(n: NotificationItem): boolean {
  return n.entity_type === "contract_job" && (n.kind === "price_updated" || n.kind === "price_accepted");
}

function getUnreadNotifsForJob(jobId: number, unreadNotifs: NotificationItem[]): NotificationItem[] {
  return unreadNotifs.filter((n) => isNegotiationNotification(n) && Number(n.entity_id) === Number(jobId));
}

function getJobActivityMs(j: ContractJob, unreadNotifs: NotificationItem[]): number {
  const related = getUnreadNotifsForJob(j.id, unreadNotifs);
  const notifMax = related.reduce((acc, n) => Math.max(acc, parseTimeMs(n.created_at)), 0);
  if (notifMax > 0) return notifMax;
  return Math.max(
    parseTimeMs((j as any).offer_updated_at ?? null),
    parseTimeMs((j as any).admin_accepted_at ?? null),
    parseTimeMs((j as any).employee_accepted_at ?? null),
    parseTimeMs((j as any).price_accepted_at ?? null),
    parseTimeMs((j as any).created_at ?? null)
  );
}

function NewNegotiationBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-900 ring-1 ring-inset ring-indigo-200">
      New Negotiation
    </span>
  );
}

function getRowVisual(j: ContractJob) {
  const isLocked = Boolean(j.price_accepted_at) || j.final_price != null;
  const needsBoth = Boolean((j as any).negotiation_occurred || (j as any).hasNegotiation);
  const adminAccepted = Boolean((j as any).admin_accepted_at || (j as any).adminAccepted);
  const empAccepted = Boolean((j as any).employee_accepted_at || (j as any).employeeAccepted);
  const oneSideAccepted = !isLocked && Boolean(j.price_offer != null) && (adminAccepted !== empAccepted) && needsBoth;
  const negotiating = !isLocked && Boolean(j.price_offer != null) && needsBoth;

  // Priority: cancelled > completed > one-side accepted > negotiating > default
  if (j.status === "cancelled") return { row: "bg-red-50/70 hover:bg-red-50", negotiatingBadge: false };
  if (j.status === "completed") return { row: "bg-green-50/50 hover:bg-green-50", negotiatingBadge: false };
  if (oneSideAccepted) return { row: "bg-emerald-50/70 hover:bg-emerald-50", negotiatingBadge: true };
  if (negotiating) return { row: "bg-yellow-50/70 hover:bg-yellow-50", negotiatingBadge: true };
  return { row: "hover:bg-black/[0.02]", negotiatingBadge: false };
}

function AdminJobCard({
  job,
  onOpen,
  onCancel,
  hasNewNegotiation
}: {
  job: ContractJob;
  onOpen(): void;
  onCancel(): void;
  hasNewNegotiation: boolean;
}) {
  const vis = getRowVisual(job);
  const isLocked = Boolean(job.price_accepted_at) || job.final_price != null;
  const needsBoth = Boolean((job as any).negotiation_occurred || (job as any).hasNegotiation);
  const ui = getNegotiationUi(job);
  const showNegotiation = !isLocked && Boolean(job.price_offer != null) && needsBoth;
  return (
    <button
      type="button"
      className={[
        "w-full rounded-2xl border border-black/10 bg-white p-4 text-left shadow-soft transition",
        "active:scale-[0.99]",
        vis.row
      ].join(" ")}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-bold">Job #{job.id}</div>
            <JobStatusBadge status={job.status} />
            <PaidFlagBadge paid={Boolean(job.paid_flag)} />
            <NegotiationBadge state={showNegotiation || vis.negotiatingBadge ? ui.state : "none"} />
            <AcceptanceIndicator label={ui.acceptanceLabel} />
            <NewNegotiationBadge show={hasNewNegotiation} />
          </div>
          <div className="mt-1 text-xs font-semibold text-black/60">
            {job.contract_employee_name || `Employee #${job.contract_employee_id}`}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs font-semibold text-black/50">Price</div>
          <div className="text-sm font-bold tabular-nums">
            {job.final_price != null ? formatMoney(job.final_price) : job.price_offer != null ? formatMoney(job.price_offer) : "—"}
          </div>
          {job.final_price == null && job.price_offer != null && ui.lastPriceByLabel ? (
            <div className="mt-0.5 text-[11px] font-semibold text-black/50">Last updated by {ui.lastPriceByLabel}</div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 text-sm text-black/70">
        <div className="line-clamp-3">{(job.description || "").trim() || "—"}</div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" className="w-full" onClick={(e) => (e.stopPropagation(), onOpen())}>
          View
        </Button>
        {job.status !== "cancelled" ? (
          <Button
            variant="danger"
            className="w-full"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
          >
            Cancel
          </Button>
        ) : (
          <div className="flex min-h-11 items-center justify-center rounded-xl border border-black/10 bg-black/[0.02] text-xs font-semibold text-black/45">
            Cancelled
          </div>
        )}
      </div>
    </button>
  );
}

export function AdminJobsPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<ContractJob[]>([]);
  const [summary, setSummary] = useState<AdminJobsSummary | null>(null);
  const [unreadNotifs, setUnreadNotifs] = useState<NotificationItem[]>([]);
  // Default to "all" to preserve visibility of historical (completed) jobs.
  const [statusFilter, setStatusFilter] = useState<"active" | "all" | "pending" | "in_progress" | "completed">("all");
  const [assignOpen, setAssignOpen] = useState(false);
  const [employees, setEmployees] = useState<ContractEmployeeListItem[]>([]);
  const [assignEmployeeId, setAssignEmployeeId] = useState<string>("");
  const [assignEmployeeQuery, setAssignEmployeeQuery] = useState("");
  const [assignEmployeeDropdownOpen, setAssignEmployeeDropdownOpen] = useState(false);
  const [assignDesc, setAssignDesc] = useState("");
  const [assignPrice, setAssignPrice] = useState("");
  const [assignImageFile, setAssignImageFile] = useState<File | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ContractJob | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [expandedEmp, setExpandedEmp] = useState<Record<string, boolean>>({});

  usePageHeader({
    title: "Jobs",
    subtitle: "All contract jobs across all employees."
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [s, j, n] = await Promise.all([
          contractJobsApi.summaryAdmin(),
          contractJobsApi.listAdmin(),
          notificationsApi.my({ unread_only: true, limit: 200 })
        ]);
        if (!alive) return;
        setSummary(s);
        setJobs(Array.isArray(j) ? j : []);
        setUnreadNotifs(Array.isArray(n?.items) ? (n.items as NotificationItem[]) : []);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
        if (!alive) return;
        setSummary(null);
        setJobs([]);
        setUnreadNotifs([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  async function refresh() {
    const [s, j, n] = await Promise.all([
      contractJobsApi.summaryAdmin(),
      contractJobsApi.listAdmin(),
      notificationsApi.my({ unread_only: true, limit: 200 })
    ]);
    setSummary(s);
    setJobs(Array.isArray(j) ? j : []);
    setUnreadNotifs(Array.isArray(n?.items) ? (n.items as NotificationItem[]) : []);
  }

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const [j, n] = await Promise.all([
          contractJobsApi.listAdmin(),
          notificationsApi.my({ unread_only: true, limit: 200 })
        ]);
        if (!alive) return;
        setJobs(Array.isArray(j) ? j : []);
        setUnreadNotifs(Array.isArray(n?.items) ? (n.items as NotificationItem[]) : []);
      } catch {
        // ignore (non-critical; manual refresh still available)
      }
    }
    const onNotifUpdated = () => void tick();
    window.addEventListener("furniture:notifications-updated", onNotifUpdated as any);
    const iv = window.setInterval(() => void tick(), 10_000);
    return () => {
      alive = false;
      window.removeEventListener("furniture:notifications-updated", onNotifUpdated as any);
      window.clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    if (!assignOpen) return;
    let alive = true;
    (async () => {
      try {
        const list = await contractEmployeesApi.list({ status: "active" });
        if (!alive) return;
        setEmployees(Array.isArray(list) ? list : []);
      } catch {
        if (!alive) return;
        setEmployees([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [assignOpen]);

  const filteredJobs = useMemo(() => {
    if (statusFilter === "all") return jobs;
    if (statusFilter === "active") return jobs.filter((j) => j.status === "pending" || j.status === "in_progress");
    return jobs.filter((j) => j.status === statusFilter);
  }, [jobs, statusFilter]);

  const grouped = useMemo(() => {
    const byEmp = new Map<number, ContractJob[]>();
    for (const j of filteredJobs) {
      const id = Number(j.contract_employee_id);
      const list = byEmp.get(id) ?? [];
      list.push(j);
      byEmp.set(id, list);
    }

    const groups = Array.from(byEmp.entries()).map(([employeeId, list]) => {
      const employeeName = list.find((j) => j.contract_employee_name)?.contract_employee_name || `Employee #${employeeId}`;
      const jobsSorted = [...list].sort((a, b) => getJobActivityMs(b, unreadNotifs) - getJobActivityMs(a, unreadNotifs));
      const maxActivity = jobsSorted.length ? getJobActivityMs(jobsSorted[0], unreadNotifs) : 0;
      const newCount = list.reduce((acc, j) => acc + (getUnreadNotifsForJob(j.id, unreadNotifs).length ? 1 : 0), 0);
      return { employeeId, employeeName, jobs: jobsSorted, maxActivity, newCount };
    });

    groups.sort((a, b) => b.maxActivity - a.maxActivity);
    return groups;
  }, [filteredJobs, unreadNotifs]);

  useEffect(() => {
    // Debugging hook: enable with `localStorage.setItem("debug_jobs", "1")`.
    if (typeof window === "undefined") return;
    if (localStorage.getItem("debug_jobs") !== "1") return;
    // eslint-disable-next-line no-console
    console.debug("[Jobs debug]", {
      jobs: jobs.length,
      filtered: filteredJobs.length,
      groups: grouped.length,
      statusFilter,
      summaryJobsTotal: summary?.jobs?.total ?? null
    });
  }, [jobs.length, filteredJobs.length, grouped.length, statusFilter, summary?.jobs?.total]);

  const assignEmpSelected = useMemo(() => {
    const id = Number(assignEmployeeId);
    if (!Number.isFinite(id) || id <= 0) return null;
    return employees.find((e) => Number(e.id) === id) || null;
  }, [assignEmployeeId, employees]);

  const assignEmpDebouncedQuery = useDebouncedValue(assignEmployeeQuery, 160);
  const assignEmpSuggestions = useMemo(() => {
    const q = (assignEmpDebouncedQuery || "").trim().toLowerCase();
    if (!q) return [];
    const starts: ContractEmployeeListItem[] = [];
    const partial: ContractEmployeeListItem[] = [];
    for (const e of employees) {
      const name = String(e.full_name || "").trim();
      const hay = name.toLowerCase();
      if (!hay) continue;
      if (hay.startsWith(q)) starts.push(e);
      else if (hay.includes(q)) partial.push(e);
    }
    const out = [...starts, ...partial];
    return out.slice(0, 12);
  }, [assignEmpDebouncedQuery, employees]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Jobs summary</div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Total jobs</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{summary?.jobs.total ?? 0}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Completed</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{summary?.jobs.completed ?? 0}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Pending</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{summary?.jobs.pending ?? 0}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">In progress</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{summary?.jobs.in_progress ?? 0}</div>
            </div>
          </div>
        </Card>

        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Contract employees financial summary</div>
          <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Total paid</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary?.financials.total_paid ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Total owed</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary?.financials.total_owed ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Current balance</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary?.financials.balance ?? 0)}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-black/50">Balance \(=\) owed − paid. Positive means the company owes contract employees.</div>
        </Card>
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-black/10 px-4 py-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">All jobs</div>
              <div className="mt-0.5 text-xs text-black/55">Click a row to view full job details.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void refresh().catch(() => null)}>
                Refresh
              </Button>
              <Button onClick={() => setAssignOpen(true)}>Assign job</Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-2xl border border-black/10 bg-white p-1">
              {(
                [
                  ["active", "Pending + In Progress"],
                  ["pending", "Pending"],
                  ["in_progress", "In Progress"],
                  ["completed", "Completed"],
                  ["all", "All"]
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={[
                    "min-h-9 rounded-xl px-3 text-xs font-semibold transition",
                    statusFilter === k ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
                  ].join(" ")}
                  onClick={() => setStatusFilter(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? <div className="px-4 py-4 text-sm text-black/60">Loading…</div> : null}

        {!loading && grouped.length === 0 ? <div className="px-4 py-4 text-sm text-black/60">No jobs found.</div> : null}

        {!loading && grouped.length > 0 ? (
          <>
            {/* Mobile: cards to avoid horizontal scrolling */}
            <div className="block space-y-3 p-4 md:hidden">
              {grouped.map((g) => {
                const key = String(g.employeeId);
                const open = Boolean(expandedEmp[key]);
                return (
                  <div key={g.employeeId} className="rounded-2xl border border-black/10 bg-white shadow-soft overflow-hidden">
                    <button
                      type="button"
                      className="w-full px-4 py-3 text-left hover:bg-black/[0.02]"
                      onClick={() => setExpandedEmp((m) => ({ ...m, [key]: !open }))}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold">{g.employeeName}</div>
                          <div className="mt-0.5 text-xs font-semibold text-black/55">{g.jobs.length} job{g.jobs.length === 1 ? "" : "s"}</div>
                        </div>
                        <div className="shrink-0 flex flex-wrap items-center justify-end gap-2">
                          <NewNegotiationBadge show={g.newCount > 0} />
                          <span className="text-xs font-semibold text-black/45">{open ? "Hide" : "View"}</span>
                        </div>
                      </div>
                    </button>

                    {open ? (
                      <div className="space-y-3 border-t border-black/10 bg-black/[0.01] p-3">
                        {g.jobs.map((j) => (
                          <AdminJobCard
                            key={j.id}
                            job={j}
                            hasNewNegotiation={getUnreadNotifsForJob(j.id, unreadNotifs).length > 0}
                            onOpen={() => nav(`/admin/jobs/${j.id}`)}
                            onCancel={() => {
                              setCancelTarget(j);
                              setCancelNote("");
                              setCancelOpen(true);
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Desktop: grouped by employee */}
            <div className="hidden overflow-x-touch md:block">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-black/[0.02] text-xs font-semibold text-black/60">
                  <tr>
                    <th className="px-4 py-3">Job</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Negotiation Status</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {grouped.map((g) => {
                    const key = String(g.employeeId);
                    const open = Boolean(expandedEmp[key]);
                    return (
                      <Fragment key={g.employeeId}>
                        <tr className="bg-black/[0.01]">
                          <td className="px-4 py-3" colSpan={7}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left hover:bg-black/[0.02]"
                              onClick={() => setExpandedEmp((m) => ({ ...m, [key]: !open }))}
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-bold">{g.employeeName}</div>
                                <div className="mt-0.5 text-xs font-semibold text-black/55">
                                  {g.jobs.length} job{g.jobs.length === 1 ? "" : "s"}
                                </div>
                              </div>
                              <div className="shrink-0 flex flex-wrap items-center gap-2">
                                <NewNegotiationBadge show={g.newCount > 0} />
                                <span className="text-xs font-semibold text-black/45">{open ? "Hide jobs" : "View jobs"}</span>
                              </div>
                            </button>
                          </td>
                        </tr>

                        {open
                          ? g.jobs.map((j) => {
                              const vis = getRowVisual(j);
                              const ui = getNegotiationUi(j);
                              const showNegotiation = ui.state !== "none";
                              const hasNew = getUnreadNotifsForJob(j.id, unreadNotifs).length > 0;
                              return (
                                <tr
                                  key={j.id}
                                  className={["cursor-pointer", vis.row].join(" ")}
                                  onClick={() => nav(`/admin/jobs/${j.id}`)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") nav(`/admin/jobs/${j.id}`);
                                  }}
                                >
                                  <td className="px-4 py-3 font-semibold">#{j.id}</td>
                                  <td className="px-4 py-3 text-black/70">
                                    <div className="line-clamp-2">{(j.description || "").trim() || "—"}</div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <NegotiationBadge state={showNegotiation || vis.negotiatingBadge ? ui.state : "none"} />
                                      <AcceptanceIndicator label={ui.acceptanceLabel} />
                                      <NewNegotiationBadge show={hasNew} />
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <JobStatusBadge status={j.status} />
                                  </td>
                                  <td className="px-4 py-3 font-semibold tabular-nums">
                                    <div className="leading-tight">
                                      <div>
                                        {j.final_price != null ? formatMoney(j.final_price) : j.price_offer != null ? formatMoney(j.price_offer) : "—"}
                                      </div>
                                      {j.final_price == null && j.price_offer != null && ui.lastPriceByLabel ? (
                                        <div className="mt-0.5 text-[11px] font-semibold text-black/50">
                                          Last updated by {ui.lastPriceByLabel}
                                        </div>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <PaidFlagBadge paid={Boolean(j.paid_flag)} />
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <div className="inline-flex justify-end gap-2">
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
                                      ) : (
                                        <span className="text-xs font-semibold text-black/45">—</span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </Card>

      <Modal open={assignOpen} title="Assign job" onClose={() => (assigning ? null : setAssignOpen(false))}>
        <div className="space-y-3">
          <div className="relative">
            <Input
              label="Assign to employee"
              value={assignEmployeeQuery}
              onChange={(e) => {
                setAssignEmployeeQuery(e.target.value);
                setAssignEmployeeDropdownOpen(true);
                // If they edit after selecting, clear the selection.
                if (assignEmployeeId) setAssignEmployeeId("");
              }}
              placeholder="Search employee…"
              onFocus={() => setAssignEmployeeDropdownOpen(true)}
              onBlur={() => {
                // Allow click selection before closing.
                window.setTimeout(() => setAssignEmployeeDropdownOpen(false), 120);
              }}
            />
            <div className="mt-1 text-xs font-semibold text-black/60">
              Required <span className="text-red-600">*</span>
            </div>

            {assignEmpSelected ? (
              <div className="mt-1 text-xs font-semibold text-black/60">
                Selected: <span className="text-black">{assignEmpSelected.full_name}</span> (#{assignEmpSelected.id})
              </div>
            ) : null}

            {assignEmployeeDropdownOpen && assignEmpSuggestions.length > 0 ? (
              <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-soft">
                <div className="max-h-72 overflow-auto p-1">
                  {assignEmpSuggestions.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-black/80 hover:bg-black/5"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => {
                        setAssignEmployeeId(String(e.id));
                        setAssignEmployeeQuery(String(e.full_name || "").trim());
                        setAssignEmployeeDropdownOpen(false);
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate">{e.full_name}</div>
                        <div className="shrink-0 text-xs font-semibold text-black/45">#{e.id}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <label className="text-xs font-semibold text-black/60">
            Description <span className="text-red-600">*</span>
            <textarea
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold min-h-[96px]"
              value={assignDesc}
              onChange={(e) => setAssignDesc(e.target.value)}
              placeholder="Describe the job…"
            />
          </label>
          <Input
            label="Price offer (optional)"
            value={assignPrice}
            onChange={(e) => setAssignPrice(e.target.value)}
            inputMode="decimal"
            placeholder="0"
          />
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
                const empId = Number(assignEmployeeId);
                if (!Number.isFinite(empId) || empId <= 0) {
                  toast.push("error", "Select an employee.");
                  return;
                }
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
                    contract_employee_id: empId,
                    description: assignDesc.trim(),
                    image_url: imageUrl || undefined,
                    price_offer: offer ?? undefined
                  });
                })()
                  .then(() => refresh())
                  .then(() => {
                    setAssignEmployeeId("");
                    setAssignEmployeeQuery("");
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
        </div>
      </Modal>

      <Modal open={cancelOpen} title={cancelTarget ? `Cancel job (Job #${cancelTarget.id})` : "Cancel job"} onClose={() => (cancelling ? null : setCancelOpen(false))}>
        <div className="space-y-3">
          <div className="text-sm text-black/70">Provide a cancellation reason (required). This will notify the other party.</div>
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
    </div>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

