import { useEffect, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { employeesApi } from "../services/endpoints";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { usePageHeader } from "../components/layout/pageHeader";
import {
  findTodayAttendanceEntry,
  getAttendanceMarkErrorMessage,
  getGeolocationPosition,
  mergeAttendanceWithClockResponse
} from "../utils/attendance";
import type { EmployeeAttendanceEntry, EmployeeClockInResponse, EmployeeDetail } from "../types/api";

function formatStatusTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/^0(\d)/, "$1");
}

export function StaffDashboardPage() {
  const toast = useToast();
  const auth = useAuth();
  const [empLoading, setEmpLoading] = useState(true);
  const [emp, setEmp] = useState<EmployeeDetail | null>(null);
  const [attBusy, setAttBusy] = useState(false);
  const [attendance, setAttendance] = useState<EmployeeAttendanceEntry[]>([]);
  const [clockRes, setClockRes] = useState<EmployeeClockInResponse | null>(null);

  usePageHeader({
    title: "Dashboard",
    subtitle: "Attendance for your current payroll month."
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setEmpLoading(true);
      setEmp(null);
      setAttendance([]);
      setClockRes(null);
      try {
        const me = await employeesApi.getMe();
        if (!alive) return;
        setEmp(me);
        try {
          const rows = await employeesApi.myAttendance({ limit: 30, offset: 0 });
          if (alive) setAttendance(rows);
        } catch {
          // non-fatal
        }
      } catch {
        if (!alive) return;
        setEmp(null);
      } finally {
        if (alive) setEmpLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [auth.token]);

  async function refreshAttendance() {
    try {
      const rows = await employeesApi.myAttendance({ limit: 30, offset: 0 });
      setAttendance(rows);
    } catch {
      // ignore
    }
  }

  async function markAttendance() {
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
        toast.push("success", "Attendance marked (Late). ₦500 lateness deduction applied.");
      } else {
        toast.push("success", "Attendance marked.");
      }
    } catch (e) {
      toast.push("error", getAttendanceMarkErrorMessage(e));
    } finally {
      setAttBusy(false);
    }
  }

  const todayEntry = findTodayAttendanceEntry(attendance);

  const statusLine = (() => {
    if (empLoading) return "Loading attendance…";
    if (!emp) return "No employee profile is linked to your account yet. Ask an administrator to link your Staff login.";
    if (clockRes?.status === "sunday") return clockRes.message ?? "Sundays are excluded.";
    if (todayEntry) {
      return `Attendance Marked – ${formatStatusTime(todayEntry.check_in_at)}`;
    }
    return "Attendance Pending";
  })();

  return (
    <div className="mx-auto max-w-lg space-y-5">
      {!empLoading && !emp ? (
        <Card>
          <div className="text-sm font-semibold text-black">Setup required</div>
          <p className="mt-2 text-sm text-black/70">{statusLine}</p>
        </Card>
      ) : (
        <Card>
          <div className="text-sm font-semibold text-black">Attendance</div>
          <p className="mt-2 text-sm text-black/80">{statusLine}</p>
          <p className="mt-3 text-xs leading-relaxed text-black/55">
            Mark attendance. Late coming attracts a ₦500 deduction.
          </p>
          {emp?.work_location ? (
            <p className="mt-2 text-xs font-semibold text-black/60">
              Assigned location: {emp.work_location.name} ({emp.work_location.allowed_radius_meters}m)
            </p>
          ) : emp ? (
            <p className="mt-2 text-xs font-semibold text-amber-900">No work location assigned. Contact an administrator.</p>
          ) : null}

          <div className="mt-5">
            <Button
              className="w-full sm:w-auto"
              isLoading={attBusy}
              loadingLabel="Checking location…"
              disabled={attBusy || Boolean(todayEntry) || !emp?.work_location || empLoading}
              onClick={() => void markAttendance()}
            >
              {todayEntry ? "Attendance already marked" : attBusy ? "Checking location…" : "Mark Attendance"}
            </Button>
          </div>

          {todayEntry ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={[
                  "rounded-full px-2 py-0.5 font-semibold",
                  todayEntry.is_late ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"
                ].join(" ")}
              >
                {todayEntry.is_late ? "Late" : "Present"}
              </span>
              {todayEntry.is_late && typeof todayEntry.late_minutes === "number" ? (
                <span className="text-black/60">{todayEntry.late_minutes} min late</span>
              ) : null}
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}
