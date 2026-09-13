import type { EmployeeAttendanceHistoryItem } from "../../types/api";
import {
  attendanceHistoryRowHighlight,
  attendanceHistoryStatusBadgeClass,
  attendanceHistoryStatusLabel,
  attendanceWaivedBadgeClass,
  attendanceWaivedBadgeLabel,
  formatWaiverTooltip
} from "../../utils/attendance";
import { formatAttendanceDuration, formatLagosTime } from "../../utils/datetime";
import { formatMoney } from "../../utils/money";
import { DataListCard, DataListMetric, ResponsiveDataList, ScrollTable } from "../ui/responsive";

function rowKey(a: EmployeeAttendanceHistoryItem) {
  return `${a.record_type}-${a.id}`;
}

function AttendanceAdminCard({ a }: { a: EmployeeAttendanceHistoryItem }) {
  return (
    <DataListCard
      title={a.attendance_date}
      subtitle={a.shift_label ?? "—"}
      badge={
        <div className="flex flex-wrap justify-end gap-1">
          <span
            className={[
              "rounded-full px-2 py-0.5 text-xs font-semibold",
              attendanceHistoryStatusBadgeClass(a)
            ].join(" ")}
          >
            {attendanceHistoryStatusLabel(a)}
          </span>
          {attendanceWaivedBadgeLabel(a) ? (
            <span className={["rounded-full px-2 py-0.5 text-xs font-semibold", attendanceWaivedBadgeClass()].join(" ")}>
              {attendanceWaivedBadgeLabel(a)}
            </span>
          ) : null}
        </div>
      }
      metrics={
        <>
          <DataListMetric
            label="Check in"
            value={a.status === "absent" || !a.check_in_at ? "—" : formatLagosTime(a.check_in_at)}
          />
          <DataListMetric
            label="Check out"
            value={a.status === "absent" || !a.check_out_at ? "—" : formatLagosTime(a.check_out_at)}
          />
          <DataListMetric
            label="Duration"
            value={
              typeof a.attendance_duration_minutes === "number"
                ? formatAttendanceDuration(a.attendance_duration_minutes)
                : "—"
            }
          />
          <DataListMetric
            label="Deduction"
            value={Number(a.deduction_naira ?? 0) > 0 ? formatMoney(a.deduction_naira) : "₦0"}
          />
        </>
      }
    >
      <div className="mt-2 text-xs text-black/55">
        {a.work_location?.name ?? "—"}
        {typeof a.distance_meters === "number" ? ` · ${Math.round(a.distance_meters)}m` : ""}
      </div>
    </DataListCard>
  );
}

export function AttendanceAdminTable({ rows }: { rows: EmployeeAttendanceHistoryItem[] }) {
  return (
    <ResponsiveDataList
      mobile={rows.map((a) => (
        <div
          key={rowKey(a)}
          className={attendanceHistoryRowHighlight(a) ? "rounded-2xl ring-2 ring-orange-200/80" : undefined}
        >
          <AttendanceAdminCard a={a} />
        </div>
      ))}
      desktop={
        <ScrollTable minWidth={820}>
          <thead className="text-black/60">
            <tr className="border-b border-black/10">
              <th className="py-3 pr-4 font-semibold">Date</th>
              <th className="py-3 pr-4 font-semibold">Shift</th>
              <th className="py-3 pr-4 font-semibold">Check in</th>
              <th className="py-3 pr-4 font-semibold">Check out</th>
              <th className="py-3 pr-4 font-semibold">Duration</th>
              <th className="py-3 pr-4 font-semibold">Status</th>
              <th className="py-3 pr-4 font-semibold">Location</th>
              <th className="py-3 pr-4 font-semibold">Distance</th>
              <th className="py-3 pr-0 text-right font-semibold">Deduction</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr
                key={rowKey(a)}
                className={[
                  "border-b border-black/5 hover:bg-black/[0.02]",
                  attendanceHistoryRowHighlight(a) ? "bg-orange-50/40" : ""
                ].join(" ")}
              >
                <td className="py-3 pr-4 font-semibold">{a.attendance_date}</td>
                <td className="py-3 pr-4 text-xs font-semibold text-black/60">{a.shift_label ?? "—"}</td>
                <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                  {a.status === "absent" || !a.check_in_at ? "—" : formatLagosTime(a.check_in_at)}
                </td>
                <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                  {a.status === "absent" || !a.check_out_at ? "—" : formatLagosTime(a.check_out_at)}
                </td>
                <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                  {typeof a.attendance_duration_minutes === "number"
                    ? formatAttendanceDuration(a.attendance_duration_minutes)
                    : "—"}
                </td>
                <td className="py-3 pr-4">
                  <span
                    className={[
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      attendanceHistoryStatusBadgeClass(a)
                    ].join(" ")}
                  >
                    {attendanceHistoryStatusLabel(a)}
                  </span>
                  {attendanceWaivedBadgeLabel(a) ? (
                    <span
                      className={[
                        "ml-2 rounded-full px-2 py-0.5 text-xs font-semibold",
                        attendanceWaivedBadgeClass()
                      ].join(" ")}
                      title={a.waivers?.length ? formatWaiverTooltip(a.waivers) : undefined}
                    >
                      {attendanceWaivedBadgeLabel(a)}
                    </span>
                  ) : null}
                  {a.is_late && typeof a.late_minutes === "number" ? (
                    <span className="ml-2 text-xs font-semibold text-black/55">{a.late_minutes} min late</span>
                  ) : null}
                  {a.is_early_check_out && typeof a.early_check_out_minutes === "number" ? (
                    <span className="ml-2 text-xs font-semibold text-black/55">
                      {a.early_check_out_minutes} min before closing
                    </span>
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
        </ScrollTable>
      }
    />
  );
}
