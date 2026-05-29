import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { AttendanceResultModal } from "./AttendanceResultModal";
import type {
  EmployeeAttendanceEntry,
  EmployeeAttendanceHistoryItem,
  EmployeeClockInResponse,
  EmployeeClockOutResponse,
  EmployeeDetail
} from "../../types/api";
import type { AttendanceResultFeedback } from "../../utils/attendance";
import { attendanceTodayStatusBadgeClass, attendanceTodayStatusLabel } from "../../utils/attendance";
import { AttendanceHistoryList } from "./AttendanceHistoryList";
import { AttendanceShiftSelectModal } from "./AttendanceShiftSelectModal";
import { AttendanceSignOutConfirmModal } from "./AttendanceSignOutConfirmModal";
import type { AttendanceShiftKey, EmployeeSignOutPreview } from "../../types/api";
import { formatAttendanceDuration, formatLagosDateTime, formatLagosTime } from "../../utils/datetime";
import { formatMoney } from "../../utils/money";
import { AttendanceRulesSummary } from "./AttendanceRulesSummary";
import { buildAttendanceRulesSummary } from "../../utils/attendanceRules";

type Props = {
  empLoading: boolean;
  emp: EmployeeDetail | null;
  attendance: EmployeeAttendanceHistoryItem[];
  attBusy: boolean;
  clockRes: EmployeeClockInResponse | null;
  clockOutRes?: EmployeeClockOutResponse | null;
  todayEntry: EmployeeAttendanceEntry | null;
  checkInAllowed?: boolean;
  checkOutAllowed?: boolean;
  dayCompleted?: boolean;
  onMarkAttendance?: () => void | Promise<void>;
  onMarkAttendanceWithShift?: (shift: AttendanceShiftKey) => void | Promise<void>;
  onRequestMarkAttendance?: () => void | Promise<void>;
  onSignOutAttendance?: () => void | Promise<void>;
  onRequestSignOut?: () => void | Promise<void>;
  shiftModalOpen?: boolean;
  onShiftModalClose?: () => void;
  signOutConfirmOpen?: boolean;
  signOutPreview?: EmployeeSignOutPreview | null;
  onSignOutConfirmClose?: () => void;
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
  clockOutRes = null,
  todayEntry,
  checkInAllowed,
  checkOutAllowed,
  dayCompleted,
  onMarkAttendance,
  onMarkAttendanceWithShift,
  onRequestMarkAttendance,
  onSignOutAttendance,
  onRequestSignOut,
  shiftModalOpen = false,
  onShiftModalClose,
  signOutConfirmOpen = false,
  signOutPreview = null,
  onSignOutConfirmClose,
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

  const rulesModel = buildAttendanceRulesSummary(emp.work_location, todayEntry);
  const canCheckIn = checkInAllowed ?? !todayEntry;
  const canCheckOut = checkOutAllowed ?? Boolean(todayEntry?.check_in_at && !todayEntry?.check_out_at);
  const completed = dayCompleted ?? Boolean(todayEntry?.check_out_at);

  const statusLine = (() => {
    if (clockRes?.status === "sunday" || clockOutRes?.status === "sunday") {
      return clockRes?.message ?? clockOutRes?.message ?? "Sundays are excluded.";
    }
    if (todayEntry) {
      const inTime = formatLagosTime(todayEntry.check_in_at);
      const outTime = todayEntry.check_out_at ? formatLagosTime(todayEntry.check_out_at) : null;
      if (outTime) return `Checked in ${inTime} · Signed out ${outTime}`;
      return `Checked in ${inTime} · Sign out pending`;
    }
    return "Not checked in today";
  })();

  return (
    <>
      {resultModal}
      <Card>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
        <div>
          <p className="text-sm font-semibold text-black">Attendance</p>
          {compact ? <p className="mt-2 text-sm text-black/80">{statusLine}</p> : null}
          <p className={compact ? "mt-2 text-xs text-black/55" : "mt-1 text-xs text-black/55"}>
            Check in on arrival and sign out when you leave.
          </p>
          <AttendanceRulesSummary model={rulesModel} className={compact ? "mt-2" : "mt-1"} />
        </div>
        <div className={`flex flex-col gap-2 sm:items-end ${compact ? "mt-5 w-full sm:mt-0 sm:w-auto" : ""}`}>
          <Button
            className={compact ? "w-full sm:w-auto" : undefined}
            isLoading={attBusy && canCheckIn}
            loadingLabel="Checking location…"
            disabled={attBusy || !canCheckIn || !emp.work_location}
            onClick={() => void (onRequestMarkAttendance ? onRequestMarkAttendance() : onMarkAttendance?.())}
          >
            {completed ? "Checked in" : canCheckIn ? (attBusy ? "Checking location…" : "Check In") : "Checked in"}
          </Button>
          {onSignOutAttendance ? (
            <Button
              variant="secondary"
              className={compact ? "w-full sm:w-auto" : undefined}
              isLoading={attBusy && canCheckOut}
              loadingLabel="Checking location…"
              disabled={attBusy || !canCheckOut || !emp.work_location}
              onClick={() => void (onRequestSignOut ? onRequestSignOut() : onSignOutAttendance?.())}
            >
              {completed ? "Signed out" : canCheckOut ? (attBusy ? "Checking location…" : "Check Out") : "Check Out"}
            </Button>
          ) : null}
        </div>
      </div>

      {todayEntry ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={["rounded-full px-2 py-0.5 font-semibold", attendanceTodayStatusBadgeClass(todayEntry, completed)].join(" ")}
          >
            {attendanceTodayStatusLabel(todayEntry, completed)}
          </span>
          <span className="text-black/60">
            In: {formatLagosDateTime(todayEntry.check_in_at)}
            {todayEntry.check_out_at ? ` · Out: ${formatLagosDateTime(todayEntry.check_out_at)}` : ""}
            {todayEntry.is_late && typeof todayEntry.late_minutes === "number" ? ` · ${todayEntry.late_minutes} min late` : ""}
            {todayEntry.is_early_check_out && typeof todayEntry.early_check_out_minutes === "number"
              ? ` · ${todayEntry.early_check_out_minutes} min before closing`
              : ""}
            {typeof todayEntry.attendance_duration_minutes === "number"
              ? ` · Duration: ${formatAttendanceDuration(todayEntry.attendance_duration_minutes)}`
              : ""}
          </span>
          <span className="text-xs font-semibold tabular-nums text-red-800">
            {Number(todayEntry.deduction_naira ?? 0) > 0 ? formatMoney(todayEntry.deduction_naira) : "₦0"}
          </span>
        </div>
      ) : clockRes?.status === "sunday" || clockOutRes?.status === "sunday" ? (
        <p className="mt-3 text-sm font-semibold text-black/70">
          {clockRes?.message ?? clockOutRes?.message ?? "Sundays are excluded."}
        </p>
      ) : null}

      {showHistory ? <AttendanceHistoryList items={attendance} compact={compact} /> : null}
    </Card>

      <AttendanceShiftSelectModal
        open={shiftModalOpen}
        busy={attBusy}
        workLocation={emp.work_location}
        onClose={() => onShiftModalClose?.()}
        onContinue={(shift) => void onMarkAttendanceWithShift?.(shift)}
      />
      <AttendanceSignOutConfirmModal
        open={signOutConfirmOpen}
        busy={attBusy}
        preview={signOutPreview}
        onClose={() => onSignOutConfirmClose?.()}
        onConfirm={() => void onSignOutAttendance?.()}
      />
    </>
  );
}
