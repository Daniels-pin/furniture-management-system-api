import type { ContractEmployeeListItem } from "../types/api";

/** Active payment request statuses (matches backend open-request filter). */
export function hasActiveMoneyRequests(row: Pick<ContractEmployeeListItem, "pending_requests">): boolean {
  return (row.pending_requests ?? 0) > 0;
}

/** Unread money-request notifications for this employee (notification state only). */
export function hasUnreadMoneyRequestNotifications(
  row: Pick<ContractEmployeeListItem, "unread_pending_requests">
): boolean {
  return (row.unread_pending_requests ?? 0) > 0;
}

/** Stable sort: unread notifications first, then other active requests, then by id. */
export function sortContractEmployeesByPendingRequests(rows: ContractEmployeeListItem[]): ContractEmployeeListItem[] {
  return [...rows].sort((a, b) => {
    const unreadDiff = (b.unread_pending_requests ?? 0) - (a.unread_pending_requests ?? 0);
    if (unreadDiff !== 0) return unreadDiff;
    const pendingDiff = (b.pending_requests ?? 0) - (a.pending_requests ?? 0);
    if (pendingDiff !== 0) return pendingDiff;
    return b.id - a.id;
  });
}
