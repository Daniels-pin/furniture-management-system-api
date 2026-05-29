import { useCallback, useEffect, useState } from "react";
import { employeesApi } from "../services/endpoints";
import { useAuth } from "../state/auth";
import type {
  AttendanceShiftKey,
  EmployeeAttendanceEntry,
  EmployeeClockInResponse,
  EmployeeClockOutResponse,
  EmployeeDetail,
  EmployeeSignOutPreview
} from "../types/api";
import type { AttendanceResultFeedback } from "../utils/attendance";
import { lateTimeLabelForAttendance } from "../utils/attendanceRules";
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
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [signOutPreview, setSignOutPreview] = useState<EmployeeSignOutPreview | null>(null);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);

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

  const refreshProfileAndAttendance = useCallback(async () => {
    try {
      const me = await employeesApi.getMe();
      setEmp(me);
      await refreshAttendance();
    } catch {
      // non-fatal
    }
  }, [refreshAttendance]);

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

  useEffect(() => {
    if (!enabled) return;

    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshProfileAndAttendance();
    };
    const onFocus = () => void refreshProfileAndAttendance();

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, refreshProfileAndAttendance]);

  const markAttendance = useCallback(
    async (shift?: AttendanceShiftKey) => {
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
          accuracy_meters: attendanceGeoAccuracyMeters(pos),
          shift
        });
        setClockRes(res);
        setClockOutRes(null);
        setShiftModalOpen(false);
        if (res.entry) {
          setAttendance((prev) => mergeAttendanceWithClockResponse(prev, res));
        } else {
          await refreshAttendance();
        }
        const lateLabel = lateTimeLabelForAttendance(me.work_location, shift);
        const lateFee = Number(me.work_location.late_coming_fee_naira ?? 0);
        setResultFeedback(getAttendanceSuccessFeedback(res, lateLabel, lateFee));
      } catch (e) {
        setResultFeedback(getAttendanceErrorFeedback(e));
      } finally {
        setAttBusy(false);
      }
    },
    [refreshAttendance]
  );

  const requestMarkAttendance = useCallback(() => {
    void (async () => {
      try {
        const me = await employeesApi.getMe();
        setEmp(me);
        if (me.work_location?.shift_mode_enabled) {
          setShiftModalOpen(true);
          return;
        }
        await markAttendance();
      } catch (e) {
        setResultFeedback(getAttendanceErrorFeedback(e));
      }
    })();
  }, [markAttendance]);

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
      setSignOutConfirmOpen(false);
      setSignOutPreview(null);
      if (res.entry) {
        setAttendance((prev) => mergeAttendanceWithClockResponse(prev, res));
      } else {
        await refreshAttendance();
      }
      const earlyFee = Number(me.work_location.early_sign_out_fee_naira ?? 0);
      setResultFeedback(getAttendanceClockOutSuccessFeedback(res, earlyFee));
    } catch (e) {
      setResultFeedback(getAttendanceClockOutErrorFeedback(e));
    } finally {
      setAttBusy(false);
    }
  }, [refreshAttendance]);

  const requestSignOut = useCallback(async () => {
    setAttBusy(true);
    try {
      const preview = await employeesApi.signOutAttendancePreview();
      setSignOutPreview(preview);
      setSignOutConfirmOpen(true);
    } catch (e) {
      setResultFeedback(getAttendanceClockOutErrorFeedback(e));
    } finally {
      setAttBusy(false);
    }
  }, []);

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
    requestMarkAttendance,
    signOutAttendance,
    requestSignOut,
    shiftModalOpen,
    setShiftModalOpen,
    signOutPreview,
    signOutConfirmOpen,
    setSignOutConfirmOpen,
    refreshAttendance,
    refreshProfileAndAttendance,
    resultFeedback,
    dismissResultFeedback
  };
}
