import axios from "axios";
import { getErrorMessage } from "../services/api";
import type { EmployeeAttendanceEntry, EmployeeClockInResponse } from "../types/api";

const ATTENDANCE_TIMEZONE = "Africa/Lagos";

/** Calendar date (YYYY-MM-DD) for attendance, aligned with backend Africa/Lagos. */
export function attendanceTodayKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ATTENDANCE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function sleep(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms));
}

function geolocationFailureMessage(err: GeolocationPositionError | Error): string {
  if (err instanceof GeolocationPositionError) {
    switch (err.code) {
      case GeolocationPositionError.PERMISSION_DENIED:
        return "Location access is required to mark attendance.";
      case GeolocationPositionError.POSITION_UNAVAILABLE:
        return "Your location is not available yet. Wait a few seconds, move to an area with better GPS signal, and try again.";
      case GeolocationPositionError.TIMEOUT:
        return "Location request timed out. Wait a few seconds and try again.";
    }
  }
  const msg = err.message || "";
  if (/permission|denied/i.test(msg)) {
    return "Location access is required to mark attendance.";
  }
  if (/timeout|timed out/i.test(msg)) {
    return "Location request timed out. Wait a few seconds and try again.";
  }
  if (/unavailable|unknown|location/i.test(msg)) {
    return "Your location is not available yet. Wait a few seconds, move to an area with better GPS signal, and try again.";
  }
  return msg || "Could not determine your location.";
}

export type GeolocationReadOptions = {
  enableHighAccuracy?: boolean;
  timeoutMs?: number;
  maximumAgeMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Hard cap for the entire read (all attempts). Prevents endless spinners on mobile Safari. */
  maxTotalMs?: number;
};

type AttemptOptions = {
  enableHighAccuracy: boolean;
  timeoutMs: number;
  maximumAgeMs: number;
};

function readPositionOnce(opts: AttemptOptions): Promise<GeolocationPosition> {
  const guardMs = opts.timeoutMs + 2_000;

  return new Promise<GeolocationPosition>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        Object.assign(new Error("Location request timed out. Wait a few seconds and try again."), {
          code: GeolocationPositionError.TIMEOUT
        })
      );
    }, guardMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(pos);
      },
      (err) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(err);
      },
      {
        enableHighAccuracy: opts.enableHighAccuracy,
        timeout: opts.timeoutMs,
        maximumAge: opts.maximumAgeMs
      }
    );
  });
}

/**
 * Resolves device coordinates with retries for transient GPS uncertainty
 * (e.g. iOS CoreLocation kCLErrorLocationUnknown / POSITION_UNAVAILABLE).
 * Each attempt is guarded by an explicit timeout so callbacks cannot hang forever.
 */
export async function getGeolocationPosition(options?: GeolocationReadOptions): Promise<GeolocationPosition> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 1_200;
  const maxTotalMs = options?.maxTotalMs ?? 38_000;
  const startedAt = Date.now();

  if (!("geolocation" in navigator)) {
    throw new Error("Geolocation is not supported on this device.");
  }

  const attempts: AttemptOptions[] = [
    {
      enableHighAccuracy: options?.enableHighAccuracy ?? true,
      timeoutMs: options?.timeoutMs ?? 12_000,
      maximumAgeMs: options?.maximumAgeMs ?? 0
    },
    {
      enableHighAccuracy: false,
      timeoutMs: 10_000,
      maximumAgeMs: Math.max(options?.maximumAgeMs ?? 0, 60_000)
    },
    {
      enableHighAccuracy: false,
      timeoutMs: 8_000,
      maximumAgeMs: Math.max(options?.maximumAgeMs ?? 0, 300_000)
    }
  ];

  let lastError: GeolocationPositionError | Error | null = null;

  for (let attempt = 0; attempt < Math.min(maxAttempts, attempts.length); attempt++) {
    if (Date.now() - startedAt >= maxTotalMs) break;

    const attemptOpts = attempts[attempt];
    const remaining = maxTotalMs - (Date.now() - startedAt);
    attemptOpts.timeoutMs = Math.min(attemptOpts.timeoutMs, Math.max(4_000, remaining - retryDelayMs));

    try {
      return await readPositionOnce(attemptOpts);
    } catch (e) {
      const geoErr =
        e instanceof GeolocationPositionError
          ? e
          : e instanceof Error
            ? e
            : new Error(typeof e === "string" ? e : "Could not determine your location.");
      lastError = geoErr;

      const code = geoErr instanceof GeolocationPositionError ? geoErr.code : undefined;
      if (code === GeolocationPositionError.PERMISSION_DENIED) break;
      if (
        attempt < maxAttempts - 1 &&
        (code === GeolocationPositionError.TIMEOUT || code === GeolocationPositionError.POSITION_UNAVAILABLE)
      ) {
        if (Date.now() - startedAt + retryDelayMs >= maxTotalMs) break;
        await sleep(retryDelayMs);
        continue;
      }
      break;
    }
  }

  if (lastError instanceof GeolocationPositionError && lastError.code === GeolocationPositionError.TIMEOUT) {
    throw lastError;
  }
  if (lastError instanceof Error && /timed out/i.test(lastError.message)) {
    throw lastError;
  }
  if (Date.now() - startedAt >= maxTotalMs) {
    throw Object.assign(new Error("Location request timed out. Wait a few seconds and try again."), {
      code: GeolocationPositionError.TIMEOUT
    });
  }

  throw lastError ?? new Error("Could not determine your location.");
}

/** User-facing message for browser geolocation failures (maps, attendance, etc.). */
export function getGeolocationUserMessage(err: unknown): string {
  if (err instanceof GeolocationPositionError) return geolocationFailureMessage(err);
  if (err instanceof Error) return geolocationFailureMessage(err);
  return "Could not determine your location.";
}

/** User-facing message for attendance geo read or clock-in API failures. */
export type AttendanceResultFeedback = {
  variant: "success" | "error" | "info";
  title: string;
  message: string;
};

export function formatAttendanceClockInTime(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/^0(\d)/, "$1");
}

export function getAttendanceBlockedNoLocationFeedback(): AttendanceResultFeedback {
  return {
    variant: "error",
    title: "Cannot mark attendance",
    message: "No work location assigned. Contact an administrator."
  };
}

export function getAttendanceSuccessFeedback(res: EmployeeClockInResponse): AttendanceResultFeedback {
  if (res.status === "already_marked") {
    return {
      variant: "info",
      title: "Attendance already marked",
      message: res.message || "You have already marked attendance for today."
    };
  }
  if (res.status === "sunday") {
    return {
      variant: "info",
      title: "No attendance required",
      message: res.message || "Sundays are excluded. No attendance is required today."
    };
  }
  const time = formatAttendanceClockInTime(res.entry?.check_in_at);
  const timePart = time ? ` at ${time}` : "";
  if (res.status === "late") {
    return {
      variant: "success",
      title: "Attendance marked",
      message: `Attendance marked successfully${timePart}. You were marked late. A ₦500 lateness deduction applies.`
    };
  }
  return {
    variant: "success",
    title: "Attendance marked",
    message: `Attendance marked successfully${timePart}.`
  };
}

export function getAttendanceErrorFeedback(err: unknown): AttendanceResultFeedback {
  return {
    variant: "error",
    title: "Attendance failed",
    message: getAttendanceMarkErrorMessage(err)
  };
}

export function getAttendanceMarkErrorMessage(err: unknown): string {
  if (err instanceof GeolocationPositionError || (err instanceof Error && !axios.isAxiosError(err))) {
    return geolocationFailureMessage(err instanceof GeolocationPositionError ? err : err);
  }

  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const detail = getErrorMessage(err);
    if (status === 403 && /work location|within your assigned/i.test(detail)) {
      return detail;
    }
    if (status === 409) return detail;
  }

  return getErrorMessage(err);
}

export function mergeAttendanceWithClockResponse(
  rows: EmployeeAttendanceEntry[],
  res: EmployeeClockInResponse
): EmployeeAttendanceEntry[] {
  if (!res.entry) return rows;
  const rest = rows.filter((r) => r.attendance_date !== res.entry!.attendance_date);
  return [res.entry, ...rest];
}

export function findTodayAttendanceEntry(
  rows: EmployeeAttendanceEntry[],
  date = new Date()
): EmployeeAttendanceEntry | null {
  const key = attendanceTodayKey(date);
  return rows.find((a) => a.attendance_date === key) ?? null;
}
