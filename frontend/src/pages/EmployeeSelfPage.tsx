import { useEffect, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { employeesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import type { EmployeeAttendanceEntry, EmployeeClockInResponse, EmployeeDetail } from "../types/api";
import {
  findTodayAttendanceEntry,
  getAttendanceMarkErrorMessage,
  getGeolocationPosition,
  mergeAttendanceWithClockResponse
} from "../utils/attendance";
import { formatMoney } from "../utils/money";
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
  const [attendance, setAttendance] = useState<EmployeeAttendanceEntry[]>([]);
  const [clockRes, setClockRes] = useState<EmployeeClockInResponse | null>(null);

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
      const pos = await getGeolocationPosition();

      const res = await employeesApi.clockInAttendanceGeo({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude
      });
      setClockRes(res);
      if (res.entry) {
        setAttendance((prev) => mergeAttendanceWithClockResponse(prev, res));
      } else {
        await refreshAttendance();
      }
      if (res.status === "already_marked") {
        toast.push("success", res.message || "Attendance already marked.");
      } else if (res.status === "sunday") {
        toast.push("success", res.message || "No attendance required today.");
      } else if (res.status === "late") {
        toast.push("success", "Clock-in recorded (Late). ₦500 lateness deduction applied.");
      } else {
        toast.push("success", "Clock-in recorded.");
      }
    } catch (e) {
      toast.push("error", getAttendanceMarkErrorMessage(e));
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

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-bold tracking-tight">Employee Details</div>
        <div className="mt-1 text-sm text-black/60">Update your own contact and account information. Payroll lines are managed by admin.</div>
      </div>

      <Card>
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <div className="text-sm font-semibold text-black">Attendance</div>
            <p className="mt-1 text-xs text-black/55">
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
            isLoading={attBusy}
            loadingLabel="Checking location…"
            disabled={attBusy || Boolean(todayEntry) || !emp.work_location}
            onClick={() => void clockIn()}
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
          <div className="mt-3 text-sm font-semibold text-black/70">{clockRes.message ?? "Sundays are excluded."}</div>
        ) : null}

        <div className="mt-4">
          <div className="text-xs font-semibold text-black/60">History</div>
          {attendance.length === 0 ? (
            <div className="mt-2 text-sm text-black/60">No attendance yet.</div>
          ) : (
            <ul className="mt-2 space-y-2">
              {attendance.slice(0, 10).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold">{a.attendance_date}</div>
                    <div className="text-xs text-black/60">
                      {new Date(a.check_in_at).toLocaleTimeString()}
                      {a.work_location?.name ? ` · ${a.work_location.name}` : ""}
                      {typeof a.distance_meters === "number" ? ` · ${Math.round(a.distance_meters)}m` : ""}
                    </div>
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
          )}
        </div>
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
