import type { EmployeeAttendanceHistoryItem } from "../../types/api";
import { formatLagosTime } from "../../utils/datetime";
import { formatMoney } from "../../utils/money";

function statusBadgeClass(status: EmployeeAttendanceHistoryItem["status"]) {
  if (status === "late") return "bg-amber-100 text-amber-900";
  if (status === "absent") return "bg-red-100 text-red-900";
  return "bg-emerald-100 text-emerald-900";
}

function statusLabel(status: EmployeeAttendanceHistoryItem["status"]) {
  if (status === "late") return "Late";
  if (status === "absent") return "Absent";
  return "Present";
}

function rowKey(a: EmployeeAttendanceHistoryItem) {
  return `${a.record_type}-${a.id}`;
}

export function AttendanceAdminTable({ rows }: { rows: EmployeeAttendanceHistoryItem[] }) {
  return (
    <table className="w-full min-w-[720px] text-left text-sm">
      <thead className="text-black/60">
        <tr className="border-b border-black/10">
          <th className="py-3 pr-4 font-semibold">Date</th>
          <th className="py-3 pr-4 font-semibold">Clock-in</th>
          <th className="py-3 pr-4 font-semibold">Status</th>
          <th className="py-3 pr-4 font-semibold">Location</th>
          <th className="py-3 pr-4 font-semibold">Distance</th>
          <th className="py-3 pr-0 text-right font-semibold">Deduction</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={rowKey(a)} className="border-b border-black/5 hover:bg-black/[0.02]">
            <td className="py-3 pr-4 font-semibold">{a.attendance_date}</td>
            <td className="py-3 pr-4 text-xs font-semibold text-black/60">
              {a.status === "absent" || !a.check_in_at ? "—" : formatLagosTime(a.check_in_at)}
            </td>
            <td className="py-3 pr-4">
              <span className={["rounded-full px-2 py-0.5 text-xs font-semibold", statusBadgeClass(a.status)].join(" ")}>
                {statusLabel(a.status)}
              </span>
              {a.status === "late" && typeof a.late_minutes === "number" ? (
                <span className="ml-2 text-xs font-semibold text-black/55">{a.late_minutes} min late</span>
              ) : null}
            </td>
            <td className="py-3 pr-4 text-xs font-semibold text-black/60">{a.work_location?.name ?? "—"}</td>
            <td className="py-3 pr-4 text-xs font-semibold text-black/60">
              {typeof a.distance_meters === "number" ? `${Math.round(a.distance_meters)}m` : "—"}
            </td>
            <td className="py-3 pr-0 text-right font-bold tabular-nums">
              {Number(a.deduction_naira ?? 0) > 0 ? formatMoney(a.deduction_naira) : "₦0"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
