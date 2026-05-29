import type {
  AttendanceShiftKey,
  CompanyLocation,
  EmployeeAttendanceHistoryItem
} from "../types/api";
import { formatLateAttendanceTime } from "./datetime";
import { formatMoney } from "./money";

/** Format a location time without inventing defaults when unset. */
export function formatLocationTime(value: string | null | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return "—";
  return formatLateAttendanceTime(raw);
}

export function attendanceShiftLabel(shift: AttendanceShiftKey): string {
  if (shift === "morning") return "Morning Shift";
  return "Full Day Shift";
}

export type AttendanceShiftRuleLine = {
  key: AttendanceShiftKey;
  label: string;
  lateAfter: string;
  signOutBy: string;
};

export type AttendanceRulesSummaryModel =
  | { kind: "no_location" }
  | {
      kind: "standard";
      locationLine: string;
      lateAfter: string;
      signOutBy: string;
      lateFee: string;
      earlySignOutFee: string;
      absenceFee: string;
    }
  | {
      kind: "shift_preview";
      locationLine: string;
      shifts: AttendanceShiftRuleLine[];
      lateFee: string;
      earlySignOutFee: string;
      absenceFee: string;
    }
  | {
      kind: "shift_selected";
      locationLine: string;
      todayShiftLabel: string;
      lateAfter: string;
      signOutBy: string;
      lateFee: string;
      earlySignOutFee: string;
      absenceFee: string;
    };

function locationLine(loc: CompanyLocation): string {
  return `${loc.name} (${loc.allowed_radius_meters}m)`;
}

function locationFees(loc: CompanyLocation) {
  return {
    lateFee: formatMoney(loc.late_coming_fee_naira),
    earlySignOutFee: formatMoney(loc.early_sign_out_fee_naira),
    absenceFee: formatMoney(loc.absence_fee_naira)
  };
}

function shiftRuleLine(loc: CompanyLocation, shift: AttendanceShiftKey): AttendanceShiftRuleLine {
  if (shift === "morning") {
    return {
      key: "morning",
      label: attendanceShiftLabel("morning"),
      lateAfter: formatLocationTime(loc.morning_shift_late_time),
      signOutBy: formatLocationTime(loc.morning_shift_closing_time)
    };
  }
  return {
    key: "full_day",
    label: attendanceShiftLabel("full_day"),
    lateAfter: formatLocationTime(loc.full_day_shift_late_time),
    signOutBy: formatLocationTime(loc.full_day_shift_closing_time)
  };
}

function shiftTimesFromEntry(
  loc: CompanyLocation,
  entry: EmployeeAttendanceHistoryItem
): { lateAfter: string; signOutBy: string } {
  const lateFromEntry = entry.expected_late_time;
  const closeFromEntry = entry.expected_check_out_time;
  if (lateFromEntry || closeFromEntry) {
    return {
      lateAfter: formatLocationTime(lateFromEntry),
      signOutBy: formatLocationTime(closeFromEntry)
    };
  }
  const shift = entry.selected_shift;
  if (shift === "morning" || shift === "full_day") {
    const rule = shiftRuleLine(loc, shift);
    return { lateAfter: rule.lateAfter, signOutBy: rule.signOutBy };
  }
  return {
    lateAfter: formatLocationTime(loc.late_attendance_time),
    signOutBy: formatLocationTime(loc.check_out_time)
  };
}

function hasCheckedInToday(entry: EmployeeAttendanceHistoryItem | null | undefined): boolean {
  return Boolean(entry?.check_in_at);
}

export function buildAttendanceRulesSummary(
  loc: CompanyLocation | null | undefined,
  todayEntry: EmployeeAttendanceHistoryItem | null | undefined
): AttendanceRulesSummaryModel {
  if (!loc) return { kind: "no_location" };

  const fees = locationFees(loc);
  const base = { locationLine: locationLine(loc), ...fees };

  if (!loc.shift_mode_enabled) {
    return {
      kind: "standard",
      ...base,
      lateAfter: formatLocationTime(loc.late_attendance_time),
      signOutBy: formatLocationTime(loc.check_out_time)
    };
  }

  if (hasCheckedInToday(todayEntry) && todayEntry) {
    const { lateAfter, signOutBy } = shiftTimesFromEntry(loc, todayEntry);
    const todayShiftLabel =
      (todayEntry.shift_label || "").trim() ||
      (todayEntry.selected_shift ? attendanceShiftLabel(todayEntry.selected_shift) : "—");
    return {
      kind: "shift_selected",
      ...base,
      todayShiftLabel,
      lateAfter,
      signOutBy
    };
  }

  return {
    kind: "shift_preview",
    ...base,
    shifts: [shiftRuleLine(loc, "morning"), shiftRuleLine(loc, "full_day")]
  };
}

/** Times for success modals / feedback — uses the same resolution as enforcement. */
export function lateTimeLabelForAttendance(
  loc: CompanyLocation,
  shift?: AttendanceShiftKey | null
): string {
  if (shift === "morning") return formatLocationTime(loc.morning_shift_late_time);
  if (shift === "full_day") return formatLocationTime(loc.full_day_shift_late_time);
  return formatLocationTime(loc.late_attendance_time);
}
