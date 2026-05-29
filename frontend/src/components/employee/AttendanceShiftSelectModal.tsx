import { useState } from "react";
import type { AttendanceShiftKey, CompanyLocation } from "../../types/api";
import { attendanceShiftLabel, buildAttendanceRulesSummary } from "../../utils/attendanceRules";
import { formatMoney } from "../../utils/money";
import { ConfirmModal } from "../ui/ConfirmModal";

type Props = {
  open: boolean;
  busy?: boolean;
  workLocation?: CompanyLocation | null;
  onClose: () => void;
  onContinue: (shift: AttendanceShiftKey) => void;
};

function shiftOptionDetail(loc: CompanyLocation, shift: AttendanceShiftKey): string {
  const preview = buildAttendanceRulesSummary(loc, null);
  if (preview.kind !== "shift_preview") return "";
  const rule = preview.shifts.find((s) => s.key === shift);
  if (!rule) return "";
  return `Late after ${rule.lateAfter} · Sign out by ${rule.signOutBy}`;
}

export function AttendanceShiftSelectModal({ open, busy = false, workLocation, onClose, onContinue }: Props) {
  const [shift, setShift] = useState<AttendanceShiftKey>("morning");
  const loc = workLocation ?? null;

  return (
    <ConfirmModal
      open={open}
      title="Select today's shift"
      message={
        <div className="space-y-3 text-sm text-black/80">
          {(["morning", "full_day"] as const).map((key) => (
            <label key={key} className="flex cursor-pointer gap-2">
              <input
                type="radio"
                name="attendance-shift"
                checked={shift === key}
                onChange={() => setShift(key)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">{attendanceShiftLabel(key)}</span>
                {loc ? (
                  <span className="mt-0.5 block text-xs text-black/55">{shiftOptionDetail(loc, key)}</span>
                ) : null}
              </span>
            </label>
          ))}
          {loc ? (
            <p className="text-xs text-black/55">
              Late fee {formatMoney(loc.late_coming_fee_naira)} · Early sign-out fee{" "}
              {formatMoney(loc.early_sign_out_fee_naira)} · Absence fee {formatMoney(loc.absence_fee_naira)}
            </p>
          ) : null}
          <p className="text-xs text-black/55">Your shift cannot be changed after check-in.</p>
        </div>
      }
      busy={busy}
      confirmLabel="Continue"
      cancelLabel="Cancel"
      onClose={onClose}
      onConfirm={() => onContinue(shift)}
    />
  );
}
