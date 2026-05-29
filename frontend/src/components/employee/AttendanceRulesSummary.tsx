import type { AttendanceRulesSummaryModel } from "../../utils/attendanceRules";

function RuleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-1.5 text-xs leading-relaxed text-black/60">
      <span className="font-semibold text-black/70">{label}:</span>
      <span>{value}</span>
    </div>
  );
}

type Props = {
  model: AttendanceRulesSummaryModel;
  className?: string;
};

export function AttendanceRulesSummary({ model, className = "" }: Props) {
  if (model.kind === "no_location") {
    return (
      <p className={["text-xs font-semibold text-amber-900", className].filter(Boolean).join(" ")}>
        No work location assigned. Contact an administrator.
      </p>
    );
  }

  const feeRows = (
    <>
      <RuleRow label="Late Fee" value={model.lateFee} />
      <RuleRow label="Early Sign-Out Fee" value={model.earlySignOutFee} />
      <RuleRow label="Absence Fee" value={model.absenceFee} />
    </>
  );

  if (model.kind === "standard") {
    return (
      <div className={["mt-2 space-y-0.5", className].filter(Boolean).join(" ")}>
        <RuleRow label="Location" value={model.locationLine} />
        <RuleRow label="Late After" value={model.lateAfter} />
        <RuleRow label="Sign Out By" value={model.signOutBy} />
        {feeRows}
      </div>
    );
  }

  if (model.kind === "shift_selected") {
    return (
      <div className={["mt-2 space-y-0.5", className].filter(Boolean).join(" ")}>
        <RuleRow label="Location" value={model.locationLine} />
        <RuleRow label="Today's Shift" value={model.todayShiftLabel} />
        <RuleRow label="Late After" value={model.lateAfter} />
        <RuleRow label="Sign Out By" value={model.signOutBy} />
        {feeRows}
      </div>
    );
  }

  return (
    <div className={["mt-2 space-y-1", className].filter(Boolean).join(" ")}>
      <RuleRow label="Location" value={model.locationLine} />
      <p className="text-xs font-semibold text-black/70">Shift mode enabled</p>
      <p className="text-xs font-semibold text-black/60">Available shifts</p>
      <ul className="space-y-2 pl-0">
        {model.shifts.map((shift) => (
          <li key={shift.key} className="list-none space-y-0.5 border-l-2 border-black/10 pl-3">
            <p className="text-xs font-semibold text-black/75">{shift.label}</p>
            <RuleRow label="Late After" value={shift.lateAfter} />
            <RuleRow label="Sign Out By" value={shift.signOutBy} />
          </li>
        ))}
      </ul>
      {feeRows}
    </div>
  );
}
