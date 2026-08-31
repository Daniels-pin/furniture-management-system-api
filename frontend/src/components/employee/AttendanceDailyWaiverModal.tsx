import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { Input } from "../ui/Input";
import { employeesApi } from "../../services/endpoints";
import { getErrorMessage } from "../../services/api";

type Props = {
  open: boolean;
  defaultDate: string;
  onClose(): void;
  onSaved(): void;
  onError(message: string): void;
};

export function AttendanceDailyWaiverModal({ open, defaultDate, onClose, onSaved, onError }: Props) {
  const [attendanceDate, setAttendanceDate] = useState(defaultDate);
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
    queryKey: ["attendance-daily-waiver-preview", attendanceDate, waiveLate, waiveEarly, waiveAbsence],
    queryFn: () =>
      employeesApi.attendanceDailyWaiverPreview({
        date: attendanceDate,
        waive_late: waiveLate,
        waive_early_sign_out: waiveEarly,
        waive_absence: waiveAbsence
      }),
    enabled: open && Boolean(attendanceDate)
  });

  useEffect(() => {
    if (!open) return;
    setAttendanceDate(defaultDate);
    setWaiveLate(false);
    setWaiveEarly(false);
    setWaiveAbsence(false);
    setReasonCode("");
    setReasonText("");
  }, [open, defaultDate]);

  useEffect(() => {
    if (reasonsQuery.data?.length && !reasonCode) {
      setReasonCode(reasonsQuery.data[0]!.code);
    }
  }, [reasonsQuery.data, reasonCode]);

  const preview = previewQuery.data ?? null;
  const anySelected = waiveLate || waiveEarly || waiveAbsence;
  const affectedTotal =
    (waiveLate ? (preview?.late_count ?? 0) : 0) +
    (waiveEarly ? (preview?.early_sign_out_count ?? 0) : 0) +
    (waiveAbsence ? (preview?.absence_count ?? 0) : 0);

  const canSave =
    anySelected && reasonCode && (reasonCode !== "other" || reasonText.trim()) && !busy && affectedTotal > 0;

  async function handleSave() {
    if (!canSave) return;
    setBusy(true);
    try {
      const result = await employeesApi.applyAttendanceDailyWaiver({
        attendance_date: attendanceDate,
        waive_late: waiveLate,
        waive_early_sign_out: waiveEarly,
        waive_absence: waiveAbsence,
        reason_code: reasonCode,
        reason_text: reasonCode === "other" ? reasonText.trim() : null
      });
      onSaved();
      onClose();
      void result;
    } catch (err) {
      onError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Waive Entire Day" onClose={busy ? () => {} : onClose}>
      <div className="space-y-4">
        <p className="text-sm text-black/60">
          Apply an exceptional waiver for all affected employees on the selected date. Attendance records and timestamps
          are not modified — only financial deductions are adjusted.
        </p>

        <Input
          label="Attendance date"
          type="date"
          value={attendanceDate}
          onChange={(e) => setAttendanceDate(e.target.value)}
        />

        {preview?.payroll_finalized_any ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
            Some employees in this month have finalized payroll and will be skipped. Reopen the month or adjust payroll
            before waiving their deductions.
          </p>
        ) : null}

        <div className="space-y-2">
          <div className="text-sm font-semibold">Deduction types</div>
          <label className="flex items-center gap-3 rounded-xl border border-black/10 px-3 py-2.5">
            <input type="checkbox" checked={waiveLate} onChange={(e) => setWaiveLate(e.target.checked)} />
            <span className="text-sm font-semibold">Late Coming</span>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-black/10 px-3 py-2.5">
            <input type="checkbox" checked={waiveEarly} onChange={(e) => setWaiveEarly(e.target.checked)} />
            <span className="text-sm font-semibold">Early Sign-Out</span>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-black/10 px-3 py-2.5">
            <input type="checkbox" checked={waiveAbsence} onChange={(e) => setWaiveAbsence(e.target.checked)} />
            <span className="text-sm font-semibold">Absence</span>
          </label>
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

        {anySelected && preview ? (
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-950">
            {waiveLate && preview.late_count > 0 ? (
              <p>{preview.late_count} employee(s) will have Late Coming deductions waived.</p>
            ) : null}
            {waiveEarly && preview.early_sign_out_count > 0 ? (
              <p>{preview.early_sign_out_count} employee(s) will have Early Sign-Out deductions waived.</p>
            ) : null}
            {waiveAbsence && preview.absence_count > 0 ? (
              <p>{preview.absence_count} employee(s) will have Absence deductions waived.</p>
            ) : null}
            {affectedTotal === 0 ? <p>No eligible deductions found for the selected types on this date.</p> : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {busy ? "Applying…" : "Confirm Daily Waiver"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
