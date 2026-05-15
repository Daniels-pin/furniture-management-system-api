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
};

/**
 * Resolves device coordinates with retries for transient GPS uncertainty
 * (e.g. iOS CoreLocation kCLErrorLocationUnknown / POSITION_UNAVAILABLE).
 */
export async function getGeolocationPosition(options?: GeolocationReadOptions): Promise<GeolocationPosition> {
  const {
    enableHighAccuracy = true,
    timeoutMs = 20_000,
    maximumAgeMs = 0,
    maxAttempts = 3,
    retryDelayMs = 1_500
  } = options ?? {};

  if (!("geolocation" in navigator)) {
    throw new Error("Geolocation is not supported on this device.");
  }

  let lastError: GeolocationPositionError | Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const useHighAccuracy = attempt === 0 ? enableHighAccuracy : false;
    const maximumAge = attempt === 0 ? maximumAgeMs : Math.max(maximumAgeMs, 5_000);

    try {
      return await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: useHighAccuracy,
          timeout: timeoutMs,
          maximumAge
        });
      });
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
      if (attempt < maxAttempts - 1 && (code === GeolocationPositionError.TIMEOUT || code === GeolocationPositionError.POSITION_UNAVAILABLE)) {
        await sleep(retryDelayMs);
        continue;
      }
      break;
    }
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
