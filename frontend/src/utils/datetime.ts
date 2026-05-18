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
