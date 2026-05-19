import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { AttendanceResultModal } from "./AttendanceResultModal";
import type {
  EmployeeAttendanceEntry,
  EmployeeAttendanceHistoryItem,
  EmployeeClockInResponse,
  EmployeeDetail
} from "../../types/api";
import type { AttendanceResultFeedback } from "../../utils/attendance";
import { AttendanceHistoryList } from "./AttendanceHistoryList";
import { formatLagosDateTime, formatLagosTime, formatLateAttendanceTime } from "../../utils/datetime";
import { formatMoney } from "../../utils/money";

type Props = {
  empLoading: boolean;
  emp: EmployeeDetail | null;
  attendance: EmployeeAttendanceHistoryItem[];
  attBusy: boolean;
  clockRes: EmployeeClockInResponse | null;
  todayEntry: EmployeeAttendanceEntry | null;
  onMarkAttendance: () => void | Promise<void>;
  resultFeedback?: AttendanceResultFeedback | null;
  onDismissResultFeedback?: () => void;
  /** When set, shown instead of hiding the card while profile is missing. */
  missingProfileMessage?: string;
  showHistory?: boolean;
  compact?: boolean;
};

export function MonthlyEmployeeAttendanceCard({
  empLoading,
  emp,
  attendance,
  attBusy,
  clockRes,
  todayEntry,
  onMarkAttendance,
  resultFeedback = null,
  onDismissResultFeedback,
  missingProfileMessage,
  showHistory = true,
  compact = false
}: Props) {
  const resultModal = (
    <AttendanceResultModal feedback={resultFeedback} onConfirm={() => onDismissResultFeedback?.()} />
  );

  if (empLoading) {
    return (
      <>
        {resultModal}
        <Card>
          <p className="text-sm text-black/60">Loading attendance…</p>
        </Card>
      </>
    );
  }

  if (!emp) {
    if (!missingProfileMessage) return resultFeedback ? <>{resultModal}</> : null;
    return (
      <>
        {resultModal}
        <Card>
          <p className="text-sm font-semibold text-black">Attendance</p>
          <p className="mt-2 text-sm text-black/70">{missingProfileMessage}</p>
        </Card>
      </>
    );
  }

  const lateTimeLabel = formatLateAttendanceTime(emp?.work_location?.late_attendance_time);

  const statusLine = (() => {
    if (clockRes?.status === "sunday") return clockRes.message ?? "Sundays are excluded.";
    if (todayEntry) return `Attendance Marked – ${formatLagosTime(todayEntry.check_in_at)}`;
    return "Attendance Pending";
  })();

  return (
    <>
      {resultModal}
      <Card>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold text-black">Attendance</p>
          {compact ? <p className="mt-2 text-sm text-black/80">{statusLine}</p> : null}
          <p className={compact ? "mt-3 text-xs leading-relaxed text-black/55" : "mt-1 text-xs text-black/55"}>
            Mark attendance by {lateTimeLabel}. Late coming attracts ₦500; unmarked workdays attract ₦1,000 absence penalty.
          </p>
          {emp.work_location ? (
            <p className="mt-1 text-xs font-semibold text-black/60">
              Assigned location: {emp.work_location.name} ({emp.work_location.allowed_radius_meters}m) · Late after{" "}
              {lateTimeLabel}
            </p>
          ) : (
            <p className="mt-1 text-xs font-semibold text-amber-900">No work location assigned. Contact an administrator.</p>
          )}
        </div>
        <Button
          className={compact ? "mt-5 w-full sm:mt-0 sm:w-auto" : undefined}
          isLoading={attBusy}
          loadingLabel="Checking location…"
          disabled={attBusy || Boolean(todayEntry)}
          onClick={() => void onMarkAttendance()}
        >
          {todayEntry ? "Attendance already marked" : attBusy ? "Checking location…" : "Mark Attendance"}
        </Button>
      </div>

      {todayEntry ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={[
              "rounded-full px-2 py-0.5 font-semibold",
              todayEntry.is_late ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"
            ].join(" ")}
          >
            {todayEntry.is_late ? "Late" : "Present"}
          </span>
          <span className="text-black/60">
            {formatLagosDateTime(todayEntry.check_in_at)}
            {todayEntry.is_late && typeof todayEntry.late_minutes === "number" ? ` · ${todayEntry.late_minutes} min late` : ""}
          </span>
          <span className="text-xs font-semibold tabular-nums text-red-800">
            {Number(todayEntry.deduction_naira ?? 0) > 0 ? formatMoney(todayEntry.deduction_naira) : "₦0"}
          </span>
        </div>
      ) : clockRes?.status === "sunday" ? (
        <p className="mt-3 text-sm font-semibold text-black/70">{clockRes.message ?? "Sundays are excluded."}</p>
      ) : null}

      {showHistory ? <AttendanceHistoryList items={attendance} compact={compact} /> : null}
    </Card>
    </>
  );
}
