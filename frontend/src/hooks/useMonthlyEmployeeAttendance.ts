import { useCallback, useEffect, useState } from "react";
import { employeesApi } from "../services/endpoints";
import { useAuth } from "../state/auth";
import type { EmployeeAttendanceEntry, EmployeeClockInResponse, EmployeeClockOutResponse, EmployeeDetail } from "../types/api";
import type { AttendanceResultFeedback } from "../utils/attendance";
import { formatCheckOutTime, formatLateAttendanceTime } from "../utils/datetime";
import {
  attendanceGeoAccuracyMeters,
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
  mergeAttendanceWithClockResponse
} from "../utils/attendance";

type Options = {
  /** When false, skips loading (e.g. admin dashboard). */
  enabled?: boolean;
};

export function useMonthlyEmployeeAttendance(options?: Options) {
  const enabled = options?.enabled ?? true;
  const auth = useAuth();
  const [empLoading, setEmpLoading] = useState(enabled);
  const [emp, setEmp] = useState<EmployeeDetail | null>(null);
  const [attBusy, setAttBusy] = useState(false);
  const [attendance, setAttendance] = useState<EmployeeAttendanceEntry[]>([]);
  const [clockRes, setClockRes] = useState<EmployeeClockInResponse | null>(null);
  const [clockOutRes, setClockOutRes] = useState<EmployeeClockOutResponse | null>(null);
  const [resultFeedback, setResultFeedback] = useState<AttendanceResultFeedback | null>(null);

  const dismissResultFeedback = useCallback(() => {
    setResultFeedback(null);
  }, []);

  const refreshAttendance = useCallback(async () => {
    try {
      const rows = await employeesApi.myAttendance({ limit: 30, offset: 0 });
      setAttendance(rows);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setEmp(null);
      setAttendance([]);
      setClockRes(null);
      setClockOutRes(null);
      setResultFeedback(null);
      setEmpLoading(false);
      return;
    }

    let alive = true;
    (async () => {
      setEmpLoading(true);
      setEmp(null);
      setAttendance([]);
      setClockRes(null);
      setClockOutRes(null);
      setResultFeedback(null);
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
  }, [enabled, auth.token]);

  const markAttendance = useCallback(async () => {
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
      setResultFeedback(getAttendanceSuccessFeedback(res, formatLateAttendanceTime(me.work_location?.late_attendance_time)));
    } catch (e) {
      setResultFeedback(getAttendanceErrorFeedback(e));
    } finally {
      setAttBusy(false);
    }
  }, [refreshAttendance]);

  const signOutAttendance = useCallback(async () => {
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
      setResultFeedback(getAttendanceClockOutSuccessFeedback(res));
    } catch (e) {
      setResultFeedback(getAttendanceClockOutErrorFeedback(e));
    } finally {
      setAttBusy(false);
    }
  }, [refreshAttendance]);

  const todayEntry = findTodayAttendanceEntry(attendance);
  const checkInAllowed = canCheckInToday(todayEntry);
  const checkOutAllowed = canCheckOutToday(todayEntry);
  const dayCompleted = hasCompletedTodayAttendance(todayEntry);

  return {
    empLoading,
    emp,
    attendance,
    attBusy,
    clockRes,
    clockOutRes,
    todayEntry,
    checkInAllowed,
    checkOutAllowed,
    dayCompleted,
    markAttendance,
    signOutAttendance,
    refreshAttendance,
    resultFeedback,
    dismissResultFeedback,
    lateTimeLabel: formatLateAttendanceTime(emp?.work_location?.late_attendance_time),
    checkOutTimeLabel: formatCheckOutTime(emp?.work_location?.check_out_time)
  };
}
