import type { EmployeeSalaryBreakdown, PayrollSummary } from "../types/api";
import { parseMoneyNumber } from "./money";

export function latenessDeductionAuto(salary: EmployeeSalaryBreakdown): number {
  return Number(salary.lateness_deduction_auto ?? salary.lateness_deduction ?? 0);
}

export function absenceDeductionAuto(salary: EmployeeSalaryBreakdown): number {
  return Number(salary.absence_deduction_auto ?? salary.absence_deduction ?? 0);
}

export function latenessDeductionEffective(salary: EmployeeSalaryBreakdown): number {
  return Number(salary.lateness_deduction ?? 0);
}

export function absenceDeductionEffective(salary: EmployeeSalaryBreakdown): number {
  return Number(salary.absence_deduction ?? 0);
}

export function earlySignOutDeductionAuto(salary: EmployeeSalaryBreakdown): number {
  return Number(salary.early_sign_out_deduction_auto ?? salary.early_sign_out_deduction ?? 0);
}

export function earlySignOutDeductionEffective(salary: EmployeeSalaryBreakdown): number {
  return Number(salary.early_sign_out_deduction ?? 0);
}

export function isEarlySignOutDeductionAdjusted(salary: EmployeeSalaryBreakdown): boolean {
  return salary.early_sign_out_deduction_override != null && salary.early_sign_out_deduction_override !== "";
}

export function isLatenessDeductionAdjusted(salary: EmployeeSalaryBreakdown): boolean {
  return salary.lateness_deduction_override != null && salary.lateness_deduction_override !== "";
}

export function isAbsenceDeductionAdjusted(salary: EmployeeSalaryBreakdown): boolean {
  return salary.absence_deduction_override != null && salary.absence_deduction_override !== "";
}

export function computePayrollPreview(input: {
  baseUsed: number;
  entriesBonus: number;
  entriesPenalties: number;
  adjustmentBonus: number;
  adjustmentDeduction: number;
  latenessDeduction: number;
  earlySignOutDeduction?: number;
  absenceDeduction: number;
}): { finalPayable: number; totalDeductions: number } {
  const bonuses = input.entriesBonus + input.adjustmentBonus;
  const penalties = input.entriesPenalties + input.adjustmentDeduction;
  const totalDeductions =
    input.latenessDeduction +
    (input.earlySignOutDeduction ?? 0) +
    input.absenceDeduction +
    penalties;
  const finalPayable = input.baseUsed + bonuses - totalDeductions;
  return { finalPayable, totalDeductions };
}

/** Month-level payroll totals for summary cards (base + bonuses − deductions = payable). */
export function getPayrollSummaryTotals(summary: PayrollSummary) {
  const base = parseMoneyNumber(summary.total_base_salary) ?? 0;
  const bonuses = parseMoneyNumber(summary.total_bonuses) ?? 0;
  const deductions = parseMoneyNumber(summary.total_deductions) ?? 0;
  const payable = parseMoneyNumber(summary.net_payroll) ?? 0;
  const totalLatenessDeductions = parseMoneyNumber(summary.total_lateness_deductions) ?? 0;
  const totalEarlySignOutDeductions = parseMoneyNumber(summary.total_early_sign_out_deductions) ?? 0;
  const totalAbsenceDeductions = parseMoneyNumber(summary.total_absence_deductions) ?? 0;
  const totalSalaries = base + bonuses;
  return {
    totalSalaries,
    totalDeductions: deductions,
    totalLatenessDeductions,
    totalEarlySignOutDeductions,
    totalAbsenceDeductions,
    totalPayable: payable,
    bonuses,
    hasBonuses: bonuses > 0.009
  };
}

export function hasPayrollSummaryData(summary: PayrollSummary | undefined): summary is PayrollSummary {
  return Boolean(summary?.period?.year && summary.period.month);
}
