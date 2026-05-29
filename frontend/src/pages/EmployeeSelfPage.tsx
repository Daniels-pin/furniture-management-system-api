import { useEffect, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { employeesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import type { EmployeeAttendanceEntry, EmployeeAttendanceHistoryItem, EmployeeClockInResponse, EmployeeClockOutResponse, EmployeeDetail } from "../types/api";
import { AttendanceHistoryList } from "../components/employee/AttendanceHistoryList";
import {
  attendanceGeoAccuracyMeters,
  attendanceTodayStatusBadgeClass,
  attendanceTodayStatusLabel,
  canCheckInToday,
  canCheckOutToday,
  findTodayAttendanceEntry,
  getAttendanceBlockedNoLocationFeedback,
  getAttendanceClockOutErrorFeedback,
  getAttendanceClockOutSuccessFeedback,
  getAttendanceErrorFeedback,
  getAttendanceSuccessFeedback,
  getAttendanceGeolocationPosition,
  hasCompletedTodayAttendance,
  mergeAttendanceWithClockResponse,
  type AttendanceResultFeedback
} from "../utils/attendance";
import { formatAttendanceDuration, formatLagosDateTime } from "../utils/datetime";
import { AttendanceResultModal } from "../components/employee/AttendanceResultModal";
import { AttendanceRulesSummary } from "../components/employee/AttendanceRulesSummary";
import { buildAttendanceRulesSummary, lateTimeLabelForAttendance } from "../utils/attendanceRules";
import { MonthlyEmployeeFinancePanel } from "../components/employee/MonthlyEmployeeFinancePanel";

export function EmployeeSelfPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emp, setEmp] = useState<EmployeeDetail | null>(null);
  const [missing, setMissing] = useState(false);

  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [docLabel, setDocLabel] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const [attBusy, setAttBusy] = useState(false);
  const [attendance, setAttendance] = useState<EmployeeAttendanceHistoryItem[]>([]);
  const [clockRes, setClockRes] = useState<EmployeeClockInResponse | null>(null);
  const [clockOutRes, setClockOutRes] = useState<EmployeeClockOutResponse | null>(null);
  const [resultFeedback, setResultFeedback] = useState<AttendanceResultFeedback | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setMissing(false);
      try {
        const d = await employeesApi.getMe();
        if (!alive) return;
        setEmp(d);
        setFullName(d.full_name);
        setAddress(d.address ?? "");
        setPhone(d.phone ?? "");
        setBankName(d.bank_name ?? "");
        setAccountNumber(d.account_number ?? "");
        setNotes(d.notes ?? "");

        try {
          const rows = await employeesApi.myAttendance({ limit: 30, offset: 0 });
          if (alive) setAttendance(rows);
        } catch {
          // non-fatal
        }
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 404) {
          setMissing(true);
        } else {
          toast.push("error", getErrorMessage(e));
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  async function refreshAttendance() {
    try {
      const rows = await employeesApi.myAttendance({ limit: 30, offset: 0 });
      setAttendance(rows);
    } catch (e) {
      // non-fatal; show toast only when user explicitly interacts
    }
  }

  async function clockIn() {
    setAttBusy(true);
    try {
      const me = await employeesApi.getMe();
      setEmp(me);
      if (!me.work_location) {
        setResultFeedback(getAttendanceBlockedNoLocationFeedback());
        return;
      }

      const pos = await getAttendanceGeolocationPosition();

      const res = await employeesApi.clockInAttendanceGeo({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_meters: attendanceGeoAccuracyMeters(pos)
      });
      setClockRes(res);
      setClockOutRes(null);
      if (res.entry) {
        setAttendance((prev) => mergeAttendanceWithClockResponse(prev, res));
      } else {
        await refreshAttendance();
      }
      setResultFeedback(
        getAttendanceSuccessFeedback(
          res,
          me.work_location ? lateTimeLabelForAttendance(me.work_location, res.entry?.selected_shift) : "closing time",
          Number(me.work_location?.late_coming_fee_naira ?? 0)
        )
      );
    } catch (e) {
      setResultFeedback(getAttendanceErrorFeedback(e));
    } finally {
      setAttBusy(false);
    }
  }

  async function clockOut() {
    setAttBusy(true);
    try {
      const me = await employeesApi.getMe();
      setEmp(me);
      if (!me.work_location) {
        setResultFeedback(getAttendanceBlockedNoLocationFeedback());
        return;
      }

      const pos = await getAttendanceGeolocationPosition();
      const res = await employeesApi.clockOutAttendanceGeo({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_meters: attendanceGeoAccuracyMeters(pos)
      });
      setClockOutRes(res);
      setClockRes(null);
      if (res.entry) {
        setAttendance((prev) => mergeAttendanceWithClockResponse(prev, res));
      } else {
        await refreshAttendance();
      }
      setResultFeedback(
        getAttendanceClockOutSuccessFeedback(res, Number(me.work_location?.early_sign_out_fee_naira ?? 0))
      );
    } catch (e) {
      setResultFeedback(getAttendanceClockOutErrorFeedback(e));
    } finally {
      setAttBusy(false);
    }
  }

  function applyDetail(d: EmployeeDetail) {
    setEmp(d);
    setFullName(d.full_name);
    setAddress(d.address ?? "");
    setPhone(d.phone ?? "");
    setBankName(d.bank_name ?? "");
    setAccountNumber(d.account_number ?? "");
    setNotes(d.notes ?? "");
  }

  async function save() {
    if (!fullName.trim()) {
      toast.push("error", "Full name is required.");
      return;
    }
    if (!bankName.trim()) {
      toast.push("error", "Bank name is required.");
      return;
    }
    if (accountNumber.trim() && !/^\d+$/.test(accountNumber.trim())) {
      toast.push("error", "Account number must contain digits only.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        full_name: fullName.trim(),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        bank_name: bankName.trim() || undefined,
        account_number: accountNumber.trim() || undefined,
        notes: notes.trim() || undefined
      };
      console.log("[employees.patchMe] payload", payload);
      const d = await employeesApi.patchMe(payload);
      console.log("[employees.patchMe] response", d);
      applyDetail(d);
      toast.push("success", "Saved.");
    } catch (e) {
      console.error("[employees.patchMe] error", e);
      toast.push("error", getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function onUploadDoc(fileList: FileList | null) {
    if (!emp || !fileList?.length) return;
    const file = fileList[0];
    setDocBusy(true);
    try {
      const d = await employeesApi.uploadDocument(emp.id, file, docLabel.trim() || undefined);
      applyDetail(d);
      setDocLabel("");
      toast.push("success", "Document uploaded.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setDocBusy(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <div className="text-sm text-black/60">Loading…</div>
      </Card>
    );
  }

  if (missing || !emp) {
    return (
      <Card>
        <div className="text-lg font-bold tracking-tight">Employee Details</div>
        <p className="mt-2 text-sm text-black/70">
          No employee profile is linked to your account yet. Ask an administrator to create your record and link your user in
          the Employees screen.
        </p>
      </Card>
    );
  }

  const todayEntry = findTodayAttendanceEntry(attendance);
  const rulesModel = buildAttendanceRulesSummary(emp.work_location, todayEntry);
  const checkInAllowed = canCheckInToday(todayEntry);
  const checkOutAllowed = canCheckOutToday(todayEntry);
  const dayCompleted = hasCompletedTodayAttendance(todayEntry);

  return (
    <div className="space-y-6">
      <AttendanceResultModal feedback={resultFeedback} onConfirm={() => setResultFeedback(null)} />
      <div>
        <div className="text-2xl font-bold tracking-tight">Employee Details</div>
        <div className="mt-1 text-sm text-black/60">Update your own contact and account information. Payroll lines are managed by admin.</div>
      </div>

      <Card>
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
          <div>
            <div className="text-sm font-semibold text-black">Attendance</div>
            <p className="mt-1 text-xs text-black/55">Check in on arrival and sign out when you leave.</p>
            <AttendanceRulesSummary model={rulesModel} />
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <Button
              isLoading={attBusy && checkInAllowed}
              loadingLabel="Checking location…"
              disabled={attBusy || !checkInAllowed || !emp.work_location}
              onClick={() => void clockIn()}
            >
              {dayCompleted ? "Checked in" : checkInAllowed ? (attBusy ? "Checking location…" : "Check In") : "Checked in"}
            </Button>
            <Button
              variant="secondary"
              isLoading={attBusy && checkOutAllowed}
              loadingLabel="Checking location…"
              disabled={attBusy || !checkOutAllowed || !emp.work_location}
              onClick={() => void clockOut()}
            >
              {dayCompleted ? "Signed out" : checkOutAllowed ? (attBusy ? "Checking location…" : "Check Out") : "Check Out"}
            </Button>
          </div>
        </div>

        {todayEntry ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={["rounded-full px-2 py-0.5 font-semibold", attendanceTodayStatusBadgeClass(todayEntry, dayCompleted)].join(" ")}
            >
              {attendanceTodayStatusLabel(todayEntry, dayCompleted)}
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
          </div>
        ) : clockRes?.status === "sunday" || clockOutRes?.status === "sunday" ? (
          <div className="mt-3 text-sm font-semibold text-black/70">
            {clockRes?.message ?? clockOutRes?.message ?? "Sundays are excluded."}
          </div>
        ) : null}

        <AttendanceHistoryList items={attendance} />
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">Your profile</div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div className="md:col-span-2">
            <Input label="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <Input label="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} required />
          <Input label="Account number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} inputMode="numeric" />
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-black/60">Notes</label>
            <textarea
              className="min-h-[88px] w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-black/40"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-6">
          <Button isLoading={saving} disabled={saving} onClick={() => void save()}>
            Save changes
          </Button>
        </div>
      </Card>

      <MonthlyEmployeeFinancePanel emp={emp} />

      <Card>
        <div className="text-sm font-semibold text-black">Documents</div>
        <p className="mt-1 text-xs text-black/55">Upload employment letters or agreements (Cloudinary).</p>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto] md:items-end">
          <Input label="Label (optional)" value={docLabel} onChange={(e) => setDocLabel(e.target.value)} />
          <div>
            <label className="mb-1 block text-xs font-semibold text-black/60">Upload</label>
            <input
              type="file"
              className="block w-full text-sm"
              disabled={docBusy}
              onChange={(e) => void onUploadDoc(e.target.files)}
            />
          </div>
        </div>
        <ul className="mt-4 space-y-2">
          {(emp.documents ?? []).length === 0 ? (
            <li className="text-sm text-black/60">No documents.</li>
          ) : (
            (emp.documents ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm">
                <a className="font-semibold underline decoration-black/30" href={d.url} target="_blank" rel="noreferrer">
                  {d.label || "Document"}
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      const out = await employeesApi.deleteDocument(emp.id, d.id);
                      applyDetail(out);
                      toast.push("success", "Document removed.");
                    } catch (e) {
                      toast.push("error", getErrorMessage(e));
                    }
                  }}
                >
                  Remove
                </Button>
              </li>
            ))
          )}
        </ul>
      </Card>
    </div>
  );
}
