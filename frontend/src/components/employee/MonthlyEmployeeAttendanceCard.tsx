import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { AttendanceResultModal } from "./AttendanceResultModal";
import type { EmployeeAttendanceEntry, EmployeeClockInResponse, EmployeeDetail } from "../../types/api";
import type { AttendanceResultFeedback } from "../../utils/attendance";

type Props = {
  empLoading: boolean;
  emp: EmployeeDetail | null;
  attendance: EmployeeAttendanceEntry[];
  attBusy: boolean;
  clockRes: EmployeeClockInResponse | null;
  todayEntry: EmployeeAttendanceEntry | null;
  onMarkAttendance: () => void | Promise<void>;
  resultFeedback?: AttendanceResultFeedback | null;
  onDismissResultFeedback?: () => void;
  /** When set, shown instead of hiding the card while profile is missing. */
  missingProfileMessage?: string;
  showHistory?: boolean;
  historyLimit?: number;
  compact?: boolean;
};

function formatStatusTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/^0(\d)/, "$1");
}

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
  historyLimit = 10,
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

  const statusLine = (() => {
    if (clockRes?.status === "sunday") return clockRes.message ?? "Sundays are excluded.";
    if (todayEntry) return `Attendance Marked – ${formatStatusTime(todayEntry.check_in_at)}`;
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
            Mark attendance. Late coming attracts a ₦500 deduction.
          </p>
          {emp.work_location ? (
            <p className="mt-1 text-xs font-semibold text-black/60">
              Assigned location: {emp.work_location.name} ({emp.work_location.allowed_radius_meters}m)
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
            {new Date(todayEntry.check_in_at).toLocaleString()}
            {todayEntry.is_late && typeof todayEntry.late_minutes === "number" ? ` · ${todayEntry.late_minutes} min late` : ""}
          </span>
        </div>
      ) : clockRes?.status === "sunday" ? (
        <p className="mt-3 text-sm font-semibold text-black/70">{clockRes.message ?? "Sundays are excluded."}</p>
      ) : null}

      {showHistory && attendance.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-black/60">{compact ? "Recent attendance" : "History"}</p>
          <ul className="mt-2 space-y-2">
            {attendance.slice(0, historyLimit).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">{a.attendance_date}</p>
                  <p className="text-xs text-black/60">
                    {new Date(a.check_in_at).toLocaleTimeString()}
                    {a.work_location?.name ? ` · ${a.work_location.name}` : ""}
                    {typeof a.distance_meters === "number" ? ` · ${Math.round(a.distance_meters)}m` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      a.is_late ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"
                    ].join(" ")}
                  >
                    {a.is_late ? "Late" : "Present"}
                  </span>
                  {a.is_late ? <span className="text-xs font-semibold text-red-800">₦500</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : showHistory && !compact ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-black/60">History</p>
          <p className="mt-2 text-sm text-black/60">No attendance yet.</p>
        </div>
      ) : null}
    </Card>
    </>
  );
}
