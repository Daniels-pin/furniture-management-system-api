import { useState } from "react";
import type { EmployeeAttendanceHistoryItem } from "../../types/api";
import {
  attendanceHistoryDetailSuffix,
  attendanceHistoryRowHighlight,
  attendanceHistoryStatusBadgeClass,
  attendanceHistoryStatusLabel,
  attendanceTodayKey
} from "../../utils/attendance";
import { formatLagosTime } from "../../utils/datetime";
import { formatMoney } from "../../utils/money";

type Props = {
  items: EmployeeAttendanceHistoryItem[];
  /** Exclude today's row from expandable history (shown in parent today section). */
  excludeToday?: boolean;
  compact?: boolean;
  expandLabel?: string;
  collapseLabel?: string;
};

function deductionLabel(item: EmployeeAttendanceHistoryItem) {
  const amount = Number(item.deduction_naira ?? 0);
  if (amount <= 0) return "₦0";
  return formatMoney(amount);
}

function rowKey(item: EmployeeAttendanceHistoryItem) {
  return `${item.record_type}-${item.id}`;
}

export function AttendanceHistoryList({
  items,
  excludeToday = true,
  compact = false,
  expandLabel = "View more history",
  collapseLabel = "Hide history"
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const todayKey = attendanceTodayKey();
  const historical = excludeToday ? items.filter((a) => a.attendance_date !== todayKey) : items;

  if (historical.length === 0) {
    if (!compact) {
      return (
        <div className="mt-4">
          <p className="text-xs font-semibold text-black/60">History</p>
          <p className="mt-2 text-sm text-black/60">No past attendance yet.</p>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-black/70 hover:text-black"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span>{compact ? "Past attendance" : "History"}</span>
        <span className="text-black/45">{expanded ? collapseLabel : expandLabel}</span>
      </button>
      {expanded ? (
        <ul className="mt-2 space-y-2">
          {historical.map((item) => (
            <li
              key={rowKey(item)}
              className={[
                "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm",
                attendanceHistoryRowHighlight(item) ? "border-orange-200 bg-orange-50/40" : "border-black/10"
              ].join(" ")}
            >
              <div className="min-w-0">
                <p className="font-semibold">{item.attendance_date}</p>
                <p className="text-xs text-black/60">
                  {item.status === "absent"
                    ? "Check in: — · Check out: —"
                    : `Check in: ${item.check_in_at ? formatLagosTime(item.check_in_at) : "—"} · Check out: ${
                        item.check_out_at ? formatLagosTime(item.check_out_at) : "—"
                      }`}
                  {item.work_location?.name ? ` · ${item.work_location.name}` : ""}
                  {attendanceHistoryDetailSuffix(item)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={[
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    attendanceHistoryStatusBadgeClass(item)
                  ].join(" ")}
                >
                  {attendanceHistoryStatusLabel(item)}
                </span>
                <span className="text-xs font-semibold tabular-nums text-red-800">{deductionLabel(item)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
