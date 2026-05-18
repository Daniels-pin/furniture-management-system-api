import { Card } from "../ui/Card";
import { formatMoney } from "../../utils/money";
import type { EmployeeDetail } from "../../types/api";
import {
  isAbsenceDeductionAdjusted,
  isLatenessDeductionAdjusted,
  latenessDeductionAuto,
  absenceDeductionAuto
} from "../../utils/payroll";

export function MonthlyEmployeeFinancePanel({ emp }: { emp: EmployeeDetail }) {
  const salary = emp.salary;
  const attendanceEligible = salary.attendance_deductions_eligible !== false;
  const latenessDed = Number(salary.lateness_deduction ?? 0);
  const absenceDed = Number(salary.absence_deduction ?? 0);
  const attendanceDeductions = latenessDed + absenceDed;
  const otherDeductions = Math.max(0, Number(salary.total_deductions ?? 0) - attendanceDeductions);

  return (
    <Card>
      <div className="text-sm font-semibold text-black">Payslip (read-only)</div>
      <p className="mt-1 text-xs text-black/55">
        {emp.period.label} — totals update when payroll entries change. Payment status is set by an administrator.
      </p>
      {!attendanceEligible ? (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
          No work location assigned — late and absence payroll deductions do not apply until a location is assigned.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span
          className={
            emp.payment.status === "paid"
              ? "rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-900"
              : "rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900"
          }
        >
          {emp.payment.status === "paid" ? "Paid" : "Unpaid"}
        </span>
        {emp.payment.payment_date ? (
          <span className="text-black/55">
            Paid on {new Date(emp.payment.payment_date).toLocaleDateString()}
            {emp.payment.payment_reference ? ` · ${emp.payment.payment_reference}` : ""}
          </span>
        ) : null}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[320px] text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs font-semibold text-black/55">
              <th className="py-2 pr-4">Payroll summary</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-b border-black/5">
              <td className="py-2.5 pr-4 font-semibold text-black/80">Base salary</td>
              <td className="py-2.5 text-right font-bold">{formatMoney(salary.base_salary)}</td>
            </tr>
            <tr className="border-b border-black/5">
              <td className="py-2.5 pr-4 text-black/70">
                Late deductions
                {attendanceEligible ? (
                  <span className="ml-1 text-black/45">({salary.lateness_count}×)</span>
                ) : null}
              </td>
              <td className="py-2.5 text-right font-bold text-red-700">−{formatMoney(latenessDed)}</td>
            </tr>
            <tr className="border-b border-black/5">
              <td className="py-2.5 pr-4 text-black/70">
                Absence deductions
                {attendanceEligible ? (
                  <span className="ml-1 text-black/45">({salary.absence_count ?? 0}×)</span>
                ) : null}
              </td>
              <td className="py-2.5 text-right font-bold text-red-700">−{formatMoney(absenceDed)}</td>
            </tr>
            {otherDeductions > 0.009 ? (
              <tr className="border-b border-black/5">
                <td className="py-2.5 pr-4 text-black/70">Other deductions &amp; penalties</td>
                <td className="py-2.5 text-right font-bold text-red-700">−{formatMoney(otherDeductions)}</td>
              </tr>
            ) : null}
            <tr className="border-b border-black/5">
              <td className="py-2.5 pr-4 font-semibold text-black/80">Total deductions</td>
              <td className="py-2.5 text-right font-bold text-red-800">−{formatMoney(salary.total_deductions)}</td>
            </tr>
            {Number(salary.bonuses_total ?? 0) > 0.009 ? (
              <tr className="border-b border-black/5">
                <td className="py-2.5 pr-4 text-black/70">Bonuses</td>
                <td className="py-2.5 text-right font-bold text-emerald-800">+{formatMoney(salary.bonuses_total)}</td>
              </tr>
            ) : null}
            <tr>
              <td className="py-3 pr-4 font-bold text-black">Final salary payable</td>
              <td className="py-3 text-right text-lg font-bold">{formatMoney(salary.final_payable)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {(isLatenessDeductionAdjusted(salary) || isAbsenceDeductionAdjusted(salary)) && attendanceEligible ? (
        <div className="mt-3 space-y-1 text-[10px] font-semibold text-amber-900">
          {isLatenessDeductionAdjusted(salary) ? (
            <p>Lateness adjusted from calculated {formatMoney(latenessDeductionAuto(salary))}.</p>
          ) : null}
          {isAbsenceDeductionAdjusted(salary) ? (
            <p>Absence adjusted from calculated {formatMoney(absenceDeductionAuto(salary))}.</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
