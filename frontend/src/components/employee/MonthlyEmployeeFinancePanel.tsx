import { Card } from "../ui/Card";
import { formatMoney } from "../../utils/money";
import type { EmployeeDetail } from "../../types/api";

export function MonthlyEmployeeFinancePanel({ emp }: { emp: EmployeeDetail }) {
  const salary = emp.salary;
  return (
    <Card>
      <div className="text-sm font-semibold text-black">Payslip (read-only)</div>
      <p className="mt-1 text-xs text-black/55">
        {emp.period.label} — totals update when payroll entries change. Payment status is set by an administrator.
      </p>
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
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
          <div className="text-xs font-semibold text-black/60">Base</div>
          <div className="mt-1 font-bold tabular-nums">{formatMoney(salary.base_salary)}</div>
        </div>
        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
          <div className="text-xs font-semibold text-black/60">Lateness ({salary.lateness_count}×)</div>
          <div className="mt-1 font-bold tabular-nums text-red-700">−{formatMoney(salary.lateness_deduction)}</div>
        </div>
        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
          <div className="text-xs font-semibold text-black/60">Penalties</div>
          <div className="mt-1 font-bold tabular-nums text-red-700">−{formatMoney(salary.penalties_total)}</div>
        </div>
        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
          <div className="text-xs font-semibold text-black/60">Bonuses</div>
          <div className="mt-1 font-bold tabular-nums text-emerald-800">+{formatMoney(salary.bonuses_total)}</div>
        </div>
      </div>
      <div className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] p-3">
        <div className="text-xs font-semibold text-black/60">Total deductions</div>
        <div className="mt-1 font-bold tabular-nums text-red-800">−{formatMoney(salary.total_deductions)}</div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-2xl border border-black bg-black px-4 py-3 text-white">
        <span className="text-sm font-bold">Final payable</span>
        <span className="text-lg font-bold tabular-nums">{formatMoney(salary.final_payable)}</span>
      </div>
    </Card>
  );
}
