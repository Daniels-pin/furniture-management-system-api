/** Business timezone for all user-visible timestamps (matches backend Africa/Lagos). */
export const BUSINESS_TIMEZONE = "Africa/Lagos";

/**
 * Parse API datetimes. Naive ISO strings from the API are UTC wall time (stored without offset).
 */
export function parseApiDateTime(iso: string | null | undefined): Date {
  if (!iso) return new Date(NaN);
  const s = iso.trim();
  if (!s) return new Date(NaN);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(`${s}Z`);
  }
  return new Date(s);
}

const defaultDateTimeOptions: Intl.DateTimeFormatOptions = {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true
};

const defaultTimeOptions: Intl.DateTimeFormatOptions = {
  timeZone: BUSINESS_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true
};

/** Full date/time in Nigerian time (not browser local). */
export function formatLagosDateTime(
  iso: string | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = parseApiDateTime(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-NG", { ...defaultDateTimeOptions, ...options });
}

/** Time only in Nigerian time. */
export function formatLagosTime(iso: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  const d = parseApiDateTime(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d
    .toLocaleTimeString("en-NG", { ...defaultTimeOptions, ...options })
    .replace(/^0(\d)/, "$1");
}

/** Date only (YYYY-MM-DD) in Nigerian time — for grouping/filtering with backend attendance dates. */
export function lagosDateKey(iso: string | Date | null | undefined): string {
  const d = iso instanceof Date ? iso : parseApiDateTime(typeof iso === "string" ? iso : undefined);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

/** Display HH:MM or HH:MM:SS as a friendly time (e.g. "8:15 AM"). */
export function formatLateAttendanceTime(value: string | null | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return "8:15 AM";
  const parts = raw.split(":");
  const hour = Number(parts[0]);
  const minute = Number(parts[1] ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return raw;
  const d = new Date(Date.UTC(2000, 0, 1, hour, minute));
  return d
    .toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" })
    .replace(/^0(\d)/, "$1");
}

/** Display configured sign-out time (e.g. "5:00 PM"). */
export function formatCheckOutTime(value: string | null | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return "5:00 PM";
  return formatLateAttendanceTime(raw);
}

/** Human-readable attendance session length (e.g. "8h 12m", "1m"). */
export function formatAttendanceDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 1) return "<1m";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins}m`;
  if (mins <= 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/** Normalize API/user input to HTML time input value (HH:MM). */
export function toTimeInputValue(value: string | null | undefined, fallback = "08:15"): string {
  const raw = (value || "").trim();
  if (!raw) return fallback;
  const parts = raw.split(":");
  if (parts.length < 2) return fallback;
  const hour = parts[0].padStart(2, "0");
  const minute = parts[1].padStart(2, "0");
  return `${hour}:${minute}`;
}
