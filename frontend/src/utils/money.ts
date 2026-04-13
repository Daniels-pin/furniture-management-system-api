function coerceMoneyNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") {
    const v: any = value;
    // Common server/client decimal shapes
    if (v && (typeof v.$numberDecimal === "string" || typeof v.$numberDecimal === "number")) {
      return coerceMoneyNumber(v.$numberDecimal);
    }
    if (v && (typeof v.value === "string" || typeof v.value === "number")) {
      return coerceMoneyNumber(v.value);
    }
    if (v && (typeof v.amount === "string" || typeof v.amount === "number")) {
      return coerceMoneyNumber(v.amount);
    }
    try {
      // Last resort: try object's string representation
      return coerceMoneyNumber(String(v));
    } catch {
      return null;
    }
  }
  if (typeof value !== "string") return null;
  const s0 = value.trim();
  if (!s0) return null;

  // Accept common API/DB formats like "1,234.50", "$1,234.50", or even "Decimal('123.45')".
  const noCommas = s0.replace(/,/g, "");
  const match = noCommas.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(value: unknown): string {
  const n = coerceMoneyNumber(value);
  if (n === null) return "—";
  // Compact: drop trailing ".00" while keeping up to 2 decimals.
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Parse API money (number or decimal string); null if missing/invalid. */
export function parseMoneyNumber(value: unknown): number | null {
  return coerceMoneyNumber(value);
}

