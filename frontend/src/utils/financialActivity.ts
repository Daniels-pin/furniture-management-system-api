import type { EmployeeTransaction } from "../types/api";

export type FinancialActivityColor = "darkGreen" | "lightGreen" | "yellow" | "red";

export function getFinancialActivityColor(t: EmployeeTransaction): FinancialActivityColor {
  // Red: negative actions (job cancelled, deduction, reversal)
  if (t.txn_type === "reversal") return "red";
  if (t.txn_type === "owed_decrease") return "red";
  if (t.status === "cancelled") return "red";

  // Yellow: pending states (requests/payments awaiting approval/finance)
  if (t.status === "requested") return "yellow";
  if (t.status === "approved_by_admin") return "yellow";
  if (t.status === "sent_to_finance") return "yellow";
  if (t.status === "pending") return "yellow"; // legacy

  // Light green: payment confirmed (money paid to employee)
  if (t.txn_type === "payment" && t.status === "paid") return "lightGreen";

  // Dark green: amount increase to employee (job value added, manual increase)
  if (t.txn_type === "owed_increase" && t.status === "paid") return "darkGreen";

  // Resolved request intents should not look "negative"; treat as yellow->removed in pending views,
  // but in history keep it neutral-yellow.
  if (t.status === "resolved") return "yellow";

  return "yellow";
}

export function getFinancialActivityClasses(color: FinancialActivityColor): { bg: string; text: string; ring: string } {
  if (color === "darkGreen") return { bg: "bg-emerald-100/70", text: "text-emerald-950", ring: "ring-emerald-200" };
  if (color === "lightGreen") return { bg: "bg-green-100/70", text: "text-green-950", ring: "ring-green-200" };
  if (color === "red") return { bg: "bg-red-100/70", text: "text-red-950", ring: "ring-red-200" };
  return { bg: "bg-yellow-100/70", text: "text-yellow-950", ring: "ring-yellow-200" };
}

export function getFinancialActivityTypeLabel(t: EmployeeTransaction): string {
  if (t.txn_type === "owed_increase") return "Increase";
  if (t.txn_type === "owed_decrease") return "Deduction";
  if (t.txn_type === "reversal") return "Cancellation / Reversal";
  return "Payment";
}

export function getFinancialActivityStatusLabel(t: EmployeeTransaction): string {
  // Employee-facing labels
  if (t.status === "requested") return "Awaiting admin approval";
  if (t.status === "approved_by_admin") return "Awaiting finance";
  if (t.status === "sent_to_finance" || t.status === "pending") return "Awaiting finance";
  if (t.status === "paid") return "Completed";
  if (t.status === "resolved") return "Resolved";
  if (t.status === "cancelled") return "Cancelled";
  return String(t.status || "—");
}

