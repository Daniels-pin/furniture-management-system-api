export type DueUrgency = "overdue" | "soon" | "normal";

export function getDueUrgency(dueDate: string | null | undefined): DueUrgency {
  if (!dueDate) return "normal";
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return "normal";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "overdue";
  if (diffDays <= 3) return "soon";
  return "normal";
}

export function dueUrgencyClasses(urgency: DueUrgency) {
  if (urgency === "overdue") {
    return "bg-[#dc2626]/[0.06]";
  }
  if (urgency === "soon") {
    return "bg-[#d97706]/[0.06]";
  }
  return "";
}

export function dueUrgencyLabel(urgency: DueUrgency) {
  if (urgency === "overdue") return "Overdue";
  if (urgency === "soon") return "Due soon";
  return null;
}

/** Placeholder monthly revenue until backend provides time-series data */
export function buildPlaceholderMonthlyRevenue(): Array<{ month: string; revenue: number }> {
  const now = new Date();
  const rows: Array<{ month: string; revenue: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    rows.push({ month: label, revenue: 0 });
  }
  return rows;
}

export function orderProgressFromStatus(status: string): number {
  if (status === "completed" || status === "delivered") return 100;
  if (status === "in_progress") return 55;
  if (status === "pending") return 15;
  return 10;
}
