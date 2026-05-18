import type { ContractJob, NotificationItem } from "../types/api";

export const CONTRACT_JOB_ALERT_KINDS = new Set([
  "job_assigned",
  "price_updated",
  "price_accepted",
  "job_cancelled"
]);

export function parseTimeMs(v?: string | null): number {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function isContractJobNotification(n: NotificationItem): boolean {
  return n.entity_type === "contract_job" && CONTRACT_JOB_ALERT_KINDS.has(n.kind);
}

export function isNegotiationNotification(n: NotificationItem): boolean {
  return n.entity_type === "contract_job" && (n.kind === "price_updated" || n.kind === "price_accepted");
}

export function isNewJobNotification(n: NotificationItem): boolean {
  return n.entity_type === "contract_job" && n.kind === "job_assigned";
}

export function getUnreadNotifsForJob(jobId: number, unreadNotifs: NotificationItem[]): NotificationItem[] {
  return unreadNotifs.filter((n) => isContractJobNotification(n) && Number(n.entity_id) === Number(jobId));
}

export function getNegotiationNotifsForJob(jobId: number, unreadNotifs: NotificationItem[]): NotificationItem[] {
  return unreadNotifs.filter((n) => isNegotiationNotification(n) && Number(n.entity_id) === Number(jobId));
}

export function getJobAlertLabel(n: NotificationItem, role: "admin" | "contract_employee"): string | null {
  if (!isContractJobNotification(n)) return null;
  if (n.kind === "job_assigned") return role === "admin" ? "New Job" : "Job Assigned";
  if (n.kind === "price_updated") return "New Negotiation";
  if (n.kind === "price_accepted") return "Offer Accepted";
  if (n.kind === "job_cancelled") return "Job Cancelled";
  return null;
}

export function getPrimaryJobAlertLabel(
  notifs: NotificationItem[],
  role: "admin" | "contract_employee"
): string | null {
  if (!notifs.length) return null;
  const priority =
    role === "admin"
      ? ["job_assigned", "price_updated", "price_accepted", "job_cancelled"]
      : ["job_assigned", "price_updated", "price_accepted", "job_cancelled"];
  for (const kind of priority) {
    const hit = notifs.find((n) => n.kind === kind);
    if (hit) return getJobAlertLabel(hit, role);
  }
  return getJobAlertLabel(notifs[0], role);
}

export type EmployeeUnreadSummary = {
  newJobCount: number;
  negotiationCount: number;
  cancelledCount: number;
  totalCount: number;
  hasUnread: boolean;
  maxActivityMs: number;
};

export function getEmployeeUnreadSummary(
  jobs: ContractJob[],
  unreadNotifs: NotificationItem[]
): EmployeeUnreadSummary {
  const jobIds = new Set(jobs.map((j) => Number(j.id)));
  const related = unreadNotifs.filter(
    (n) => n.entity_type === "contract_job" && jobIds.has(Number(n.entity_id)) && isContractJobNotification(n)
  );
  const newJobCount = related.filter((n) => n.kind === "job_assigned").length;
  const negotiationCount = related.filter((n) => isNegotiationNotification(n)).length;
  const cancelledCount = related.filter((n) => n.kind === "job_cancelled").length;
  const maxActivityMs = related.reduce((acc, n) => Math.max(acc, parseTimeMs(n.created_at)), 0);
  return {
    newJobCount,
    negotiationCount,
    cancelledCount,
    totalCount: related.length,
    hasUnread: related.length > 0,
    maxActivityMs
  };
}

export function getJobActivityMs(j: ContractJob, unreadNotifs: NotificationItem[]): number {
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

export function sortJobsByAttention(jobs: ContractJob[], unreadNotifs: NotificationItem[]): ContractJob[] {
  return [...jobs].sort((a, b) => {
    const aUnread = getUnreadNotifsForJob(a.id, unreadNotifs).length;
    const bUnread = getUnreadNotifsForJob(b.id, unreadNotifs).length;
    if (aUnread !== bUnread) return bUnread - aUnread;
    return getJobActivityMs(b, unreadNotifs) - getJobActivityMs(a, unreadNotifs);
  });
}

export function sortEmployeeGroupsByAttention<T extends { hasUnread: boolean; maxActivityMs: number }>(
  groups: T[]
): T[] {
  return [...groups].sort((a, b) => {
    if (a.hasUnread !== b.hasUnread) return a.hasUnread ? -1 : 1;
    return b.maxActivityMs - a.maxActivityMs;
  });
}

/** Captured when an employee group is expanded so per-job indicators survive employee-level mark-read. */
export type JobAttentionSnapshot = {
  primaryLabel: string | null;
  hasNewJob: boolean;
  hasNegotiation: boolean;
  hasCancelled: boolean;
};

export function snapshotJobAttention(
  jobId: number,
  unreadNotifs: NotificationItem[],
  role: "admin" | "contract_employee" = "admin"
): JobAttentionSnapshot | null {
  const notifs = getUnreadNotifsForJob(jobId, unreadNotifs);
  if (!notifs.length) return null;
  return {
    primaryLabel: getPrimaryJobAlertLabel(notifs, role),
    hasNewJob: notifs.some((n) => n.kind === "job_assigned"),
    hasNegotiation: notifs.some((n) => isNegotiationNotification(n)),
    hasCancelled: notifs.some((n) => n.kind === "job_cancelled")
  };
}

export function captureEmployeeJobAttention(
  jobs: ContractJob[],
  employeeId: number,
  unreadNotifs: NotificationItem[],
  role: "admin" | "contract_employee" = "admin"
): Record<number, JobAttentionSnapshot> {
  const captured: Record<number, JobAttentionSnapshot> = {};
  for (const j of jobs) {
    if (Number(j.contract_employee_id) !== Number(employeeId)) continue;
    const snap = snapshotJobAttention(j.id, unreadNotifs, role);
    if (snap) captured[j.id] = snap;
  }
  return captured;
}

export function resolveJobAttentionLabel(
  jobId: number,
  unreadNotifs: NotificationItem[],
  snapshots: Record<number, JobAttentionSnapshot>,
  role: "admin" | "contract_employee" = "admin"
): string | null {
  const live = getPrimaryJobAlertLabel(getUnreadNotifsForJob(jobId, unreadNotifs), role);
  if (live) return live;
  return snapshots[jobId]?.primaryLabel ?? null;
}

export function jobHasPersistedAttention(
  jobId: number,
  unreadNotifs: NotificationItem[],
  snapshots: Record<number, JobAttentionSnapshot>
): boolean {
  if (getUnreadNotifsForJob(jobId, unreadNotifs).length > 0) return true;
  return Boolean(snapshots[jobId]);
}

export function jobHasNewJobAttention(
  jobId: number,
  unreadNotifs: NotificationItem[],
  snapshots: Record<number, JobAttentionSnapshot>
): boolean {
  if (getUnreadNotifsForJob(jobId, unreadNotifs).some((n) => n.kind === "job_assigned")) return true;
  return Boolean(snapshots[jobId]?.hasNewJob);
}

/** Row surface for jobs with unread or persisted attention (after group expand). */
export function getJobAttentionRowClass(
  job: ContractJob,
  jobId: number,
  unreadNotifs: NotificationItem[],
  snapshots: Record<number, JobAttentionSnapshot>,
  fallbackRowClass: string
): string {
  if (job.status === "cancelled" && !jobHasPersistedAttention(jobId, unreadNotifs, snapshots)) {
    return fallbackRowClass;
  }
  const label = resolveJobAttentionLabel(jobId, unreadNotifs, snapshots, "admin");
  if (jobHasNewJobAttention(jobId, unreadNotifs, snapshots) || label === "New Job") {
    return "bg-amber-50/70 hover:bg-amber-50 ring-1 ring-inset ring-amber-200/70";
  }
  if (label) {
    return "bg-indigo-50/40 hover:bg-indigo-50 ring-1 ring-inset ring-indigo-200/50";
  }
  return fallbackRowClass;
}
