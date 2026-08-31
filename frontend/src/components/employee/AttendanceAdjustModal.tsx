import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { Input } from "../ui/Input";
import { employeesApi } from "../../services/endpoints";
import { getErrorMessage } from "../../services/api";
import type { AttendanceMonitorRow, AttendanceWaiverDeductionType } from "../../types/api";
import { attendanceMonitorStatusLabel } from "../../utils/attendance";
import { formatLagosTime } from "../../utils/datetime";
import { formatMoney } from "../../utils/money";

const DEDUCTION_LABELS: Record<AttendanceWaiverDeductionType, string> = {
  late: "Late Coming Deduction",
  early_sign_out: "Early Sign-Out Deduction",
  absence: "Absence Deduction"
};

type Props = {
  open: boolean;
  row: AttendanceMonitorRow | null;
  onClose(): void;
  onSaved(): void;
  onError(message: string): void;
};

export function AttendanceAdjustModal({ open, row, onClose, onSaved, onError }: Props) {
  const [waiveLate, setWaiveLate] = useState(false);
  const [waiveEarly, setWaiveEarly] = useState(false);
  const [waiveAbsence, setWaiveAbsence] = useState(false);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);

  const reasonsQuery = useQuery({
    queryKey: ["attendance-waiver-reasons"],
    queryFn: () => employeesApi.attendanceWaiverReasons(),
    enabled: open
  });

  const previewQuery = useQuery({
    queryKey: [
      "attendance-waiver-preview",
      row?.employee_id,
      row?.attendance_date,
      waiveLate,
      waiveEarly,
      waiveAbsence
    ],
    queryFn: () =>
      employeesApi.attendanceWaiverPreview({
        employee_id: row!.employee_id,
        date: row!.attendance_date,
        waive_late: waiveLate,
        waive_early_sign_out: waiveEarly,
        waive_absence: waiveAbsence
      }),
    enabled: open && row != null
  });

  useEffect(() => {
    if (!open) return;
    setWaiveLate(false);
    setWaiveEarly(false);
    setWaiveAbsence(false);
    setReasonCode("");
    setReasonText("");
  }, [open, row?.employee_id, row?.attendance_date]);

  useEffect(() => {
    if (reasonsQuery.data?.length && !reasonCode) {
      setReasonCode(reasonsQuery.data[0]!.code);
    }
  }, [reasonsQuery.data, reasonCode]);

  const preview = previewQuery.data ?? null;
  const deductionMap = useMemo(() => {
    const map = new Map(preview?.deductions.map((d) => [d.deduction_type, d]) ?? []);
    return map;
  }, [preview]);

  const canSave =
    (waiveLate || waiveEarly || waiveAbsence) &&
    reasonCode &&
    (reasonCode !== "other" || reasonText.trim()) &&
    !preview?.payroll_finalized &&
    !busy;

  async function handleSave() {
    if (!row || !canSave) return;
    setBusy(true);
    try {
      await employeesApi.applyAttendanceWaiver({
        employee_id: row.employee_id,
        attendance_date: row.attendance_date,
        waive_late: waiveLate,
        waive_early_sign_out: waiveEarly,
        waive_absence: waiveAbsence,
        reason_code: reasonCode,
        reason_text: reasonCode === "other" ? reasonText.trim() : null
      });
      onSaved();
      onClose();
    } catch (err) {
      onError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!row) return null;

  return (
    <Modal open={open} title="Adjust Attendance" onClose={busy ? () => {} : onClose}>
      <div className="space-y-4">
        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-4 text-sm">
          <div className="font-bold">{row.full_name}</div>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold text-black/50">Attendance Date</dt>
              <dd className="font-semibold">{row.attendance_date}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-black/50">Status</dt>
              <dd className="font-semibold">{attendanceMonitorStatusLabel(row.status)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-black/50">Check-In</dt>
              <dd className="font-semibold">{row.check_in_at ? formatLagosTime(row.check_in_at) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-black/50">Check-Out</dt>
              <dd className="font-semibold">{row.check_out_at ? formatLagosTime(row.check_out_at) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-black/50">Location</dt>
              <dd className="font-semibold">{row.work_location?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-black/50">Shift</dt>
              <dd className="font-semibold">{row.shift_label ?? "—"}</dd>
            </div>
          </dl>
        </div>

        {preview?.payroll_finalized ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
            Payroll for this month has already been finalized. Reopen the month or create a payroll adjustment before
            waiving deductions.
          </p>
        ) : null}

        <div className="space-y-2">
          <div className="text-sm font-semibold">Waive deductions</div>
          {(["late", "early_sign_out", "absence"] as AttendanceWaiverDeductionType[]).map((type) => {
            const info = deductionMap.get(type);
            const checked = type === "late" ? waiveLate : type === "early_sign_out" ? waiveEarly : waiveAbsence;
            const setChecked =
              type === "late" ? setWaiveLate : type === "early_sign_out" ? setWaiveEarly : setWaiveAbsence;
            const disabled = !info?.available || info.already_waived || preview?.payroll_finalized;
            return (
              <label
                key={type}
                className={[
                  "flex items-start gap-3 rounded-xl border px-3 py-2.5",
                  disabled ? "border-black/5 bg-black/[0.02] opacity-60" : "border-black/10"
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{DEDUCTION_LABELS[type]}</span>
                  <span className="block text-xs text-black/55">
                    {info?.already_waived
                      ? "Already waived"
                      : info?.available
                        ? formatMoney(info.amount_naira)
                        : "No deduction for this date"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <Select
          label="Reason (required)"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          options={(reasonsQuery.data ?? []).map((r) => ({ value: r.code, label: r.label }))}
        />
        {reasonCode === "other" ? (
          <Input
            label="Custom reason"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="Describe the reason…"
          />
        ) : null}

        {preview && Number(preview.total_credit_naira) > 0 ? (
          <p className="text-sm font-semibold text-emerald-800">
            Credit back to employee: {formatMoney(preview.total_credit_naira)}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {busy ? "Saving…" : "Save Waiver"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
