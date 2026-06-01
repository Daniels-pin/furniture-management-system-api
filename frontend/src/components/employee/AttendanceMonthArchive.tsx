import { useCallback, useEffect, useMemo, useState } from "react";
import { employeesApi } from "../../services/endpoints";
import { getErrorMessage } from "../../services/api";
import { useToast } from "../../state/toast";
import type { EmployeeAttendanceHistoryItem, EmployeeAttendanceMonthSummary } from "../../types/api";
import {
  attendanceHistoryStatusBadgeClass,
  attendanceHistoryStatusLabel,
  attendanceTodayKey
} from "../../utils/attendance";
import { formatAttendanceDuration, formatLagosTime } from "../../utils/datetime";
import { Button } from "../ui/Button";

const PAGE_SIZE = 15;

function formatMonthDay(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function AttendanceHistoryRows({ rows }: { rows: EmployeeAttendanceHistoryItem[] }) {
  if (rows.length === 0) {
    return <p className="py-4 text-sm font-semibold text-black/55">No records for this month.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-black/60">
          <tr className="border-b border-black/10">
            <th className="py-2.5 pr-4 font-semibold">Date</th>
            <th className="py-2.5 pr-4 font-semibold">Shift</th>
            <th className="py-2.5 pr-4 font-semibold">Check In</th>
            <th className="py-2.5 pr-4 font-semibold">Check Out</th>
            <th className="py-2.5 pr-4 font-semibold">Duration</th>
            <th className="py-2.5 pr-0 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.record_type}-${row.id}-${row.attendance_date}`} className="border-b border-black/5">
              <td className="py-2.5 pr-4 font-semibold">{formatMonthDay(row.attendance_date)}</td>
              <td className="py-2.5 pr-4 text-xs font-semibold text-black/60">{row.shift_label ?? "—"}</td>
              <td className="py-2.5 pr-4 text-xs font-semibold text-black/60">
                {row.status === "absent" || !row.check_in_at ? "—" : formatLagosTime(row.check_in_at)}
              </td>
              <td className="py-2.5 pr-4 text-xs font-semibold text-black/60">
                {row.status === "absent" || !row.check_out_at ? "—" : formatLagosTime(row.check_out_at)}
              </td>
              <td className="py-2.5 pr-4 text-xs font-semibold text-black/60">
                {typeof row.attendance_duration_minutes === "number"
                  ? formatAttendanceDuration(row.attendance_duration_minutes)
                  : "—"}
              </td>
              <td className="py-2.5 pr-0">
                <span
                  className={[
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    attendanceHistoryStatusBadgeClass(row)
                  ].join(" ")}
                >
                  {attendanceHistoryStatusLabel(row)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type MonthPanelProps = {
  employeeId: number;
  summary: EmployeeAttendanceMonthSummary;
  defaultExpanded: boolean;
};

function MonthPanel({ employeeId, summary, defaultExpanded }: MonthPanelProps) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(defaultExpanded);
  const [rows, setRows] = useState<EmployeeAttendanceHistoryItem[]>([]);
  const [total, setTotal] = useState(0);

  const loadPage = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      try {
        const page = await employeesApi.attendanceHistoryPage(employeeId, {
          year: summary.year,
          month: summary.month,
          limit: PAGE_SIZE,
          offset: nextOffset
        });
        setRows(page.items);
        setTotal(page.total);
        setOffset(page.offset);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [employeeId, summary.year, summary.month, toast]
  );

  useEffect(() => {
    if (!expanded) return;
    void loadPage(offset);
  }, [expanded, loadPage, offset]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="rounded-xl border border-black/10">
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => {
            const next = !v;
            if (next) setOffset(0);
            return next;
          });
        }}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-black/[0.02]"
      >
        <span className="text-sm font-bold tracking-tight">
          {expanded ? "▼" : "▶"} {summary.label}
        </span>
        <span className="text-xs font-semibold text-black/55">{summary.record_count} records</span>
      </button>
      {expanded ? (
        <div className="border-t border-black/10 px-4 pb-4 pt-3">
          {loading ? (
            <p className="py-4 text-sm font-semibold text-black/55">Loading attendance records…</p>
          ) : (
            <>
              <AttendanceHistoryRows rows={rows} />
              {total > PAGE_SIZE ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-black/55">
                    Page {currentPage} of {pageCount} · {total} records
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={offset <= 0 || loading}
                      onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={offset + PAGE_SIZE >= total || loading}
                      onClick={() => setOffset((v) => v + PAGE_SIZE)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function AttendanceMonthArchive({
  employeeId,
  months
}: {
  employeeId: number;
  months: EmployeeAttendanceMonthSummary[];
}) {
  const todayKey = useMemo(() => attendanceTodayKey(), []);
  const [currentYear, currentMonth] = useMemo(() => {
    const [y, m] = todayKey.split("-").map(Number);
    return [y, m] as const;
  }, [todayKey]);

  const monthsWithCurrent = useMemo(() => {
    const hasCurrent = months.some((m) => m.year === currentYear && m.month === currentMonth);
    if (hasCurrent) return months;
    const label = new Date(currentYear, currentMonth - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric"
    });
    return [{ year: currentYear, month: currentMonth, label, record_count: 0 }, ...months];
  }, [months, currentYear, currentMonth]);

  if (monthsWithCurrent.length === 0) {
    return <p className="text-sm font-semibold text-black/55">No attendance history yet.</p>;
  }

  return (
    <div className="space-y-3">
      {monthsWithCurrent.map((month) => (
        <MonthPanel
          key={`${month.year}-${month.month}`}
          employeeId={employeeId}
          summary={month}
          defaultExpanded={month.year === currentYear && month.month === currentMonth}
        />
      ))}
    </div>
  );
}
