export function isValidThousandsCommaNumber(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true; // allow empty while typing
  // Accept either plain digits (optionally decimals) or properly grouped thousands with commas.
  // Examples: 1000, 1000.5, 1,000, 1,000,000.50
  if (/^\d+(?:\.\d+)?$/.test(s)) return true;
  return /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s);
}

export function sanitizeMoneyInput(raw: string): string {
  return raw.replace(/,/g, "").trim();
}

/**
 * Returns:
 * - null: empty input
 * - NaN: invalid format or non-finite
 * - number: valid parsed number
 */
export function parseMoneyInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (!isValidThousandsCommaNumber(s)) return NaN;
  const n = Number(sanitizeMoneyInput(s));
  return Number.isFinite(n) ? n : NaN;
}
