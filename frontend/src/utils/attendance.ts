import axios from "axios";
import { getErrorMessage } from "../services/api";
import type {
  EmployeeAttendanceEntry,
  EmployeeAttendanceHistoryItem,
  EmployeeClockInResponse,
  EmployeeClockOutResponse
} from "../types/api";
import { BUSINESS_TIMEZONE, formatAttendanceDuration, formatLagosTime, lagosDateKey } from "./datetime";
import { formatMoney } from "./money";

const ATTENDANCE_TIMEZONE = BUSINESS_TIMEZONE;

/**
 * Conservative accuracy when the browser omits coords.accuracy (common on desktop Wi‑Fi/IP fixes;
 * also happens on some mobile browsers). Server caps contribution at 100m.
 */
const MISSING_GEO_ACCURACY_FALLBACK_METERS = 75;
/** After all retries, reject fixes worse than this so users get a clear retry message instead of a 403. */
const ATTENDANCE_MAX_ACCEPTABLE_ACCURACY_METERS = 150;
/** Stop retrying once a fix is at or below this horizontal accuracy (meters). */
const ATTENDANCE_GOOD_ACCURACY_METERS = 80;

/** Calendar date (YYYY-MM-DD) for attendance, aligned with backend Africa/Lagos. */
export function attendanceTodayKey(date = new Date()): string {
  return lagosDateKey(date);
}

function sleep(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms));
}

/**
 * Coarse device hint for geolocation strategy only (not used for security decisions).
 * Desktop browsers often use Wi-Fi/IP positioning with omitted or poor accuracy values.
 */
export function isLikelyDesktopDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return false;
  if (/iPad/i.test(ua)) return false;
  if (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua)) return false;
  return true;
}

async function probeGeolocationPermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  if (!("permissions" in navigator) || typeof navigator.permissions?.query !== "function") {
    return "unknown";
  }
  try {
    const result = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return result.state as "granted" | "denied" | "prompt";
  } catch {
    return "unknown";
  }
}

function permissionDeniedMessage(): string {
  if (isLikelyDesktopDevice()) {
    return "Enable location access in your browser (lock icon in the address bar → Site settings → Location), then try again.";
  }
  return "Location access is required to mark attendance. Enable location in your device settings and try again.";
}

function assertGeolocationSupported(): void {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error(
      "Location access requires a secure connection (HTTPS). Open this site over HTTPS or contact your administrator."
    );
  }
  if (!("geolocation" in navigator)) {
    throw new Error("Geolocation is not supported on this device.");
  }
}

async function assertGeolocationEnvironment(): Promise<void> {
  assertGeolocationSupported();
  const permission = await probeGeolocationPermission();
  if (permission === "denied") {
    throw Object.assign(new Error(permissionDeniedMessage()), {
      code: GeolocationPositionError.PERMISSION_DENIED
    });
  }
}

function horizontalAccuracyMeters(pos: GeolocationPosition): number | null {
  const acc = pos.coords.accuracy;
  return Number.isFinite(acc) && acc > 0 ? acc : null;
}

function isBetterGeolocationFix(candidate: GeolocationPosition, current: GeolocationPosition | null): boolean {
  if (!current) return true;
  const candAcc = horizontalAccuracyMeters(candidate);
  const currAcc = horizontalAccuracyMeters(current);
  if (candAcc === null) return currAcc !== null;
  if (currAcc === null) return true;
  return candAcc < currAcc;
}

function geolocationFailureMessage(err: GeolocationPositionError | Error): string {
  if (err instanceof GeolocationPositionError) {
    switch (err.code) {
      case GeolocationPositionError.PERMISSION_DENIED:
        return permissionDeniedMessage();
      case GeolocationPositionError.POSITION_UNAVAILABLE:
        return isLikelyDesktopDevice()
          ? "Your location is not available yet. Check that location is enabled for this site, ensure Wi-Fi is on, wait a few seconds, and try again."
          : "Your location is not available yet. Wait a few seconds, move to an area with better GPS signal, and try again.";
      case GeolocationPositionError.TIMEOUT:
        return "Location request timed out. Wait a few seconds and try again.";
    }
  }
  const msg = err.message || "";
  if (/permission|denied/i.test(msg)) {
    return permissionDeniedMessage();
  }
  if (/secure connection|https/i.test(msg)) {
    return msg;
  }
  if (/accuracy too low/i.test(msg)) {
    return msg;
  }
  if (/timeout|timed out/i.test(msg)) {
    return "Location request timed out. Wait a few seconds and try again.";
  }
  if (/unavailable|unknown|location/i.test(msg)) {
    return isLikelyDesktopDevice()
      ? "Your location is not available yet. Check that location is enabled for this site, ensure Wi-Fi is on, wait a few seconds, and try again."
      : "Your location is not available yet. Wait a few seconds, move to an area with better GPS signal, and try again.";
  }
  return msg || "Could not determine your location.";
}

export type GeolocationReadOptions = {
  enableHighAccuracy?: boolean;
  timeoutMs?: number;
  maximumAgeMs?: number;
  /** When true, never reuse a cached position (required for geo-attendance clock-in). */
  requireFresh?: boolean;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Hard cap for the entire read (all attempts). Prevents endless spinners on mobile Safari. */
  maxTotalMs?: number;
  /** Desktop: keep trying across attempts and return the most precise fix. */
  preferBestAccuracy?: boolean;
  /** Use Wi-Fi-first attempt order (better for desktop browsers). */
  desktopOptimized?: boolean;
};

type AttemptOptions = {
  enableHighAccuracy: boolean;
  timeoutMs: number;
  maximumAgeMs: number;
};

function buildAttemptSequence(options: GeolocationReadOptions): AttemptOptions[] {
  const requireFresh = options.requireFresh ?? false;
  const baseMaxAge = requireFresh ? 0 : (options.maximumAgeMs ?? 0);
  const desktop = options.desktopOptimized ?? false;

  if (requireFresh && desktop) {
    return [
      { enableHighAccuracy: false, timeoutMs: options.timeoutMs ?? 18_000, maximumAgeMs: 0 },
      { enableHighAccuracy: false, timeoutMs: 16_000, maximumAgeMs: 0 },
      { enableHighAccuracy: true, timeoutMs: 15_000, maximumAgeMs: 0 },
      { enableHighAccuracy: true, timeoutMs: 12_000, maximumAgeMs: 0 },
      { enableHighAccuracy: false, timeoutMs: 10_000, maximumAgeMs: 0 }
    ];
  }

  if (requireFresh) {
    return [
      {
        enableHighAccuracy: options.enableHighAccuracy ?? true,
        timeoutMs: options.timeoutMs ?? 15_000,
        maximumAgeMs: 0
      },
      { enableHighAccuracy: true, timeoutMs: 12_000, maximumAgeMs: 0 },
      { enableHighAccuracy: false, timeoutMs: 10_000, maximumAgeMs: 0 },
      { enableHighAccuracy: false, timeoutMs: 8_000, maximumAgeMs: 0 }
    ];
  }

  return [
    {
      enableHighAccuracy: options.enableHighAccuracy ?? true,
      timeoutMs: options.timeoutMs ?? 12_000,
      maximumAgeMs: baseMaxAge
    },
    {
      enableHighAccuracy: false,
      timeoutMs: 10_000,
      maximumAgeMs: Math.max(baseMaxAge, 60_000)
    },
    {
      enableHighAccuracy: false,
      timeoutMs: 8_000,
      maximumAgeMs: Math.max(baseMaxAge, 300_000)
    }
  ];
}

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
  const requireFresh = options?.requireFresh ?? false;
  const maxAttempts = options?.maxAttempts ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 1_200;
  const maxTotalMs = options?.maxTotalMs ?? 38_000;
  const preferBestAccuracy = options?.preferBestAccuracy ?? false;
  const startedAt = Date.now();

  assertGeolocationSupported();

  const attempts = buildAttemptSequence(options ?? {});
  let lastError: GeolocationPositionError | Error | null = null;
  let best: GeolocationPosition | null = null;

  for (let attempt = 0; attempt < Math.min(maxAttempts, attempts.length); attempt++) {
    if (Date.now() - startedAt >= maxTotalMs) break;

    const attemptOpts = { ...attempts[attempt] };
    const remaining = maxTotalMs - (Date.now() - startedAt);
    attemptOpts.timeoutMs = Math.min(attemptOpts.timeoutMs, Math.max(4_000, remaining - retryDelayMs));

    try {
      const pos = await readPositionOnce(attemptOpts);
      if (preferBestAccuracy && isBetterGeolocationFix(pos, best)) {
        best = pos;
      }

      const acc = horizontalAccuracyMeters(pos);
      const goodEnough = acc !== null && acc <= ATTENDANCE_GOOD_ACCURACY_METERS;

      if (!preferBestAccuracy || goodEnough) {
        return preferBestAccuracy && best ? best : pos;
      }

      if (attempt < maxAttempts - 1 && Date.now() - startedAt + retryDelayMs < maxTotalMs) {
        await sleep(retryDelayMs);
        continue;
      }

      return best ?? pos;
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

  if (best) return best;

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

function assertAttendanceAccuracyAcceptable(pos: GeolocationPosition): void {
  const acc = horizontalAccuracyMeters(pos);
  if (acc !== null && acc > ATTENDANCE_MAX_ACCEPTABLE_ACCURACY_METERS) {
    throw new Error(
      `Location accuracy too low (about ${Math.round(acc)}m). Move closer to a window, ensure Wi-Fi is enabled, and try again.`
    );
  }
}

/**
 * Horizontal accuracy sent to the geo clock-in API.
 * When accuracy is omitted, apply a conservative fallback so server tolerance matches real-world GPS/Wi‑Fi uncertainty.
 */
export function attendanceGeoAccuracyMeters(pos: GeolocationPosition): number | undefined {
  const acc = horizontalAccuracyMeters(pos);
  if (acc !== null) return acc;
  return MISSING_GEO_ACCURACY_FALLBACK_METERS;
}

/** Fresh device coordinates for geo-attendance (no stale cached positions). */
export async function getAttendanceGeolocationPosition(): Promise<GeolocationPosition> {
  await assertGeolocationEnvironment();
  const desktop = isLikelyDesktopDevice();
  const pos = await getGeolocationPosition({
    requireFresh: true,
    enableHighAccuracy: !desktop,
    maxAttempts: desktop ? 5 : 4,
    maxTotalMs: desktop ? 50_000 : 45_000,
    preferBestAccuracy: desktop,
    desktopOptimized: desktop
  });
  assertAttendanceAccuracyAcceptable(pos);
  return pos;
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
  const t = formatLagosTime(iso);
  return t === "—" ? null : t;
}

export function getAttendanceBlockedNoLocationFeedback(): AttendanceResultFeedback {
  return {
    variant: "error",
    title: "Cannot mark attendance",
    message: "No work location assigned. Contact an administrator."
  };
}

export function getAttendanceSuccessFeedback(
  res: EmployeeClockInResponse,
  lateTimeLabel = "closing time",
  lateFeeNaira = 0
): AttendanceResultFeedback {
  if (res.status === "already_checked_in" || res.status === "already_checked_out") {
    return {
      variant: "info",
      title: res.status === "already_checked_out" ? "Attendance completed" : "Already checked in",
      message: res.message || "You have already checked in for today."
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
    const feePart =
      lateFeeNaira > 0 ? ` A ${formatMoney(lateFeeNaira)} late-coming deduction applies.` : "";
    return {
      variant: "success",
      title: "Checked in",
      message: `Check-in recorded${timePart}. You were marked late (after ${lateTimeLabel}).${feePart}`
    };
  }
  return {
    variant: "success",
    title: "Checked in",
    message: `Check-in recorded${timePart}.`
  };
}

export function getAttendanceClockOutSuccessFeedback(
  res: EmployeeClockOutResponse,
  earlyFeeNaira = 0
): AttendanceResultFeedback {
  if (res.status === "already_checked_out") {
    return {
      variant: "info",
      title: "Already signed out",
      message: res.message || "You have already signed out for today."
    };
  }
  if (res.status === "not_checked_in") {
    return {
      variant: "info",
      title: "Check in first",
      message: res.message || "Check in before signing out."
    };
  }
  if (res.status === "sunday") {
    return {
      variant: "info",
      title: "No attendance required",
      message: res.message || "Sundays are excluded. No attendance is required today."
    };
  }
  const time = formatAttendanceClockInTime(res.entry?.check_out_at);
  const timePart = time ? ` at ${time}` : "";
  if (res.entry?.is_early_check_out) {
    const feePart =
      earlyFeeNaira > 0 ? ` A ${formatMoney(earlyFeeNaira)} early sign-out deduction may apply.` : "";
    return {
      variant: "success",
      title: "Signed out",
      message: `Check-out recorded${timePart}. You signed out before your location's closing time.${feePart}`
    };
  }
  return {
    variant: "success",
    title: "Signed out",
    message: `Check-out recorded${timePart}.`
  };
}

export function getAttendanceClockOutErrorFeedback(err: unknown): AttendanceResultFeedback {
  return {
    variant: "error",
    title: "Sign-out failed",
    message: getAttendanceMarkErrorMessage(err)
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
      if (isLikelyDesktopDevice()) {
        return `${detail} On desktop, ensure location is enabled for this site and try again near your assigned work area.`;
      }
      return detail;
    }
    if (status === 409) return detail;
  }

  return getErrorMessage(err);
}

export function mergeAttendanceWithClockResponse(
  rows: EmployeeAttendanceEntry[],
  res: EmployeeClockInResponse | EmployeeClockOutResponse
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
  return (
    rows.find((a) => a.attendance_date === key && a.record_type === "attendance" && a.status !== "absent") ?? null
  );
}

export function hasCompletedTodayAttendance(entry: EmployeeAttendanceEntry | null): boolean {
  return Boolean(entry?.check_out_at);
}

export function canCheckInToday(entry: EmployeeAttendanceEntry | null): boolean {
  return !entry || entry.status === "absent";
}

export function canCheckOutToday(entry: EmployeeAttendanceEntry | null): boolean {
  return Boolean(entry?.check_in_at && !entry.check_out_at);
}

export function attendanceHistoryStatusLabel(item: EmployeeAttendanceHistoryItem): string {
  switch (item.status) {
    case "late_early_check_out":
      return "Late · Early check-out";
    case "early_check_out":
      return "Checked out before closing time";
    case "short_session":
      return "Short session";
    case "late":
      return "Late";
    case "absent":
      return "Absent";
    case "incomplete_day":
      return "Incomplete Day";
    case "checked_in":
      return "Checked in";
    case "present":
      return "Present";
    default:
      if (item.is_early_check_out) return "Checked out before closing time";
      return "Present";
  }
}

/** Compact labels for the attendance monitor dashboard table. */
export function attendanceMonitorStatusLabel(
  status: EmployeeAttendanceHistoryItem["status"]
): string {
  switch (status) {
    case "late_early_check_out":
      return "Late · Early Sign-Out";
    case "early_check_out":
      return "Early Sign-Out";
    case "short_session":
      return "Short Session";
    case "late":
      return "Late";
    case "absent":
      return "Absent";
    case "incomplete_day":
      return "Incomplete Day";
    case "checked_in":
      return "Checked In";
    case "present":
      return "Present";
    default:
      return "Present";
  }
}

export function attendanceMonitorStatusBadgeClass(
  status: EmployeeAttendanceHistoryItem["status"]
): string {
  const item = { status } as EmployeeAttendanceHistoryItem;
  return attendanceHistoryStatusBadgeClass(item);
}

export function attendanceHistoryStatusBadgeClass(item: EmployeeAttendanceHistoryItem): string {
  switch (item.status) {
    case "late_early_check_out":
      return "bg-orange-100 text-orange-900";
    case "early_check_out":
      return "bg-orange-100 text-orange-900";
    case "short_session":
      return "bg-yellow-100 text-yellow-900";
    case "late":
      return "bg-amber-100 text-amber-900";
    case "absent":
      return "bg-red-100 text-red-900";
    case "incomplete_day":
      return "bg-orange-100 text-orange-900";
    case "checked_in":
      return "bg-sky-100 text-sky-900";
    case "present":
      return "bg-emerald-100 text-emerald-900";
    default:
      if (item.is_early_check_out) return "bg-orange-100 text-orange-900";
      return "bg-emerald-100 text-emerald-900";
  }
}

export function attendanceHistoryDetailSuffix(item: EmployeeAttendanceHistoryItem): string {
  const parts: string[] = [];
  if (item.is_late && typeof item.late_minutes === "number") {
    parts.push(`${item.late_minutes} min late`);
  }
  if (item.is_early_check_out && typeof item.early_check_out_minutes === "number") {
    parts.push(`${item.early_check_out_minutes} min before closing`);
  }
  if (typeof item.attendance_duration_minutes === "number") {
    parts.push(`Duration: ${formatAttendanceDuration(item.attendance_duration_minutes)}`);
  }
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

export function attendanceTodayStatusLabel(
  entry: EmployeeAttendanceEntry | null,
  dayCompleted?: boolean
): string {
  if (!entry) return "Not checked in";
  if (dayCompleted || entry.check_out_at) {
    return attendanceHistoryStatusLabel(entry);
  }
  return entry.is_late ? "Checked in · Late" : "Checked in";
}

export function attendanceTodayStatusBadgeClass(
  entry: EmployeeAttendanceEntry | null,
  dayCompleted?: boolean
): string {
  if (!entry) return "bg-black/10 text-black/70";
  if (dayCompleted || entry.check_out_at) {
    return attendanceHistoryStatusBadgeClass(entry);
  }
  return entry.is_late ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900";
}

export function attendanceHistoryRowHighlight(item: EmployeeAttendanceHistoryItem): boolean {
  return (
    item.status === "early_check_out" ||
    item.status === "late_early_check_out" ||
    item.status === "short_session" ||
    Boolean(item.is_early_check_out)
  );
}
