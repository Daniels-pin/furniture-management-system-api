import { CompanyLogo } from "../layout/CompanyLogo";
import { APP_NAME } from "../../config/app";
import type { PayrollExport, PayrollExportEmployee, PayrollExportLineItem } from "../../types/api";
import { formatMoney } from "../../utils/money";

function LineItems({
  title,
  lines,
  total,
  totalLabel
}: {
  title: string;
  lines: PayrollExportLineItem[];
  total: string | number;
  totalLabel: string;
}) {
  if (lines.length === 0 && Number(total) <= 0) return null;
  return (
    <div className="mt-3">
      <div className="text-xs font-bold uppercase tracking-wide text-black/55">{title}</div>
      <ul className="mt-1 space-y-0.5 text-sm">
        {lines.map((line, i) => (
          <li key={`${title}-${i}`} className="flex justify-between gap-4 tabular-nums">
            <span className="text-black/80">{line.date_label || line.label}</span>
            <span className="font-semibold shrink-0">{formatMoney(line.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex justify-between gap-4 border-t border-black/10 pt-1 text-sm font-bold tabular-nums">
        <span>{totalLabel}</span>
        <span>{formatMoney(total)}</span>
      </div>
    </div>
  );
}

function EmployeeSection({ emp }: { emp: PayrollExportEmployee }) {
  return (
    <section className="break-inside-avoid rounded-xl border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-black/10 pb-3">
        <div>
          <h3 className="text-base font-bold">{emp.name}</h3>
          <p className="text-xs text-black/55">
            ID {emp.employee_id}
            {emp.department ? ` · ${emp.department}` : ""}
          </p>
        </div>
        <span
          className={
            emp.payment_status === "Paid"
              ? "rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
              : "rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900"
          }
        >
          {emp.payment_status}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div>
          <span className="text-black/50">Bank</span>
          <div className="font-semibold">{emp.bank_name || "—"}</div>
        </div>
        <div>
          <span className="text-black/50">Account Name</span>
          <div className="font-semibold">{emp.account_name || "—"}</div>
        </div>
        <div>
          <span className="text-black/50">Account Number</span>
          <div className="font-semibold tabular-nums">{emp.account_number || "—"}</div>
        </div>
        <div>
          <span className="text-black/50">Salary Month</span>
          <div className="font-semibold">{emp.salary_month}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-black/50">Base Salary</div>
          <div className="font-bold tabular-nums">{formatMoney(emp.base_salary)}</div>
        </div>
        <div>
          <div className="text-xs text-black/50">Bonuses</div>
          <div className="font-bold tabular-nums text-emerald-800">+{formatMoney(emp.bonuses_total)}</div>
        </div>
        <div>
          <div className="text-xs text-black/50">Salary Increments</div>
          <div className="font-bold tabular-nums text-emerald-800">+{formatMoney(emp.increments_total)}</div>
        </div>
        <div>
          <div className="text-xs text-black/50">Total Deductions</div>
          <div className="font-bold tabular-nums text-red-800">−{formatMoney(emp.total_deductions)}</div>
        </div>
      </div>

      <LineItems title="Bonuses" lines={emp.bonus_lines} total={emp.bonuses_total} totalLabel="Total Bonuses" />
      <LineItems
        title="Salary Increments"
        lines={emp.increment_lines}
        total={emp.increments_total}
        totalLabel="Total Salary Increments"
      />
      <LineItems
        title="Late Coming"
        lines={emp.lateness_lines}
        total={emp.lateness_deduction}
        totalLabel="Total Late Deductions"
      />
      <LineItems
        title="Absence"
        lines={emp.absence_lines}
        total={emp.absence_deduction}
        totalLabel="Total Absence Deductions"
      />
      <LineItems
        title="Early Sign-Out"
        lines={emp.early_sign_out_lines}
        total={emp.early_sign_out_deduction}
        totalLabel="Total Early Sign-Out Deductions"
      />
      <LineItems
        title="Manual Deductions"
        lines={emp.manual_deduction_lines}
        total={emp.manual_deductions}
        totalLabel="Total Manual Deductions"
      />

      <div className="mt-4 rounded-lg bg-black px-3 py-2 text-white">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="font-semibold text-white/80">Final Payable</span>
          <span className="text-lg font-bold tabular-nums">{formatMoney(emp.final_payable)}</span>
        </div>
        <p className="mt-1 text-xs text-white/60">
          Base + Bonuses + Increments − Deductions = Final Payable
        </p>
      </div>
    </section>
  );
}

type Props = {
  data: PayrollExport;
};

export function PayrollExportDocument({ data }: Props) {
  return (
    <div className="mx-auto max-w-[210mm] bg-[#f5f5f5] p-6 text-black">
      <header className="rounded-xl border border-black/10 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <CompanyLogo variant="sidebar" className="max-h-14" />
            <div>
              <div className="text-lg font-bold">{data.company_name || APP_NAME}</div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">{data.payroll_month} Payroll</h1>
            </div>
          </div>
          <div className="text-right text-sm">
            <div
              className={
                data.payroll_status === "Paid"
                  ? "inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
                  : "inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900"
              }
            >
              {data.payroll_status}
            </div>
            <div className="mt-2 text-black/55">Generated by</div>
            <div className="font-semibold">{data.generated_by}</div>
            <div className="mt-2 text-black/55">Generated</div>
            <div className="font-semibold">
              {data.generated_date}
              <br />
              {data.generated_time}
            </div>
          </div>
        </div>
      </header>

      <section className="mt-4 rounded-xl border border-black/10 bg-white p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-black/55">Payroll Summary</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-black/10 text-xs uppercase text-black/50">
              <tr>
                <th className="py-2 pr-3 font-semibold">Name</th>
                <th className="py-2 pr-3 font-semibold">Dept</th>
                <th className="py-2 pr-3 font-semibold">Bank</th>
                <th className="py-2 pr-3 font-semibold">Account</th>
                <th className="py-2 pr-3 font-semibold text-right">Base</th>
                <th className="py-2 pr-3 font-semibold text-right">Bonuses</th>
                <th className="py-2 pr-3 font-semibold text-right">Deductions</th>
                <th className="py-2 pr-3 font-semibold text-right">Payable</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp) => (
                <tr key={emp.employee_id} className="border-b border-black/5">
                  <td className="py-2 pr-3 font-semibold">{emp.name}</td>
                  <td className="py-2 pr-3 text-black/70">{emp.department || "—"}</td>
                  <td className="py-2 pr-3 text-black/70">{emp.bank_name || "—"}</td>
                  <td className="py-2 pr-3 tabular-nums text-black/70">{emp.account_number || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(emp.base_salary)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(emp.bonuses_total)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-red-800">
                    {formatMoney(emp.total_deductions)}
                  </td>
                  <td className="py-2 pr-3 text-right font-bold tabular-nums">{formatMoney(emp.final_payable)}</td>
                  <td className="py-2 text-xs font-semibold">{emp.payment_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-4 space-y-4">
        {data.employees.map((emp) => (
          <EmployeeSection key={emp.employee_id} emp={emp} />
        ))}
      </div>

      <footer className="mt-6 break-inside-avoid rounded-xl border-2 border-black bg-black p-4 text-white">
        <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">Grand Totals</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-white/60">Total Employees</div>
            <div className="text-lg font-bold">{data.summary.employee_count}</div>
          </div>
          <div>
            <div className="text-white/60">Total Base Salaries</div>
            <div className="text-lg font-bold tabular-nums">{formatMoney(data.summary.total_base_salaries)}</div>
          </div>
          <div>
            <div className="text-white/60">Total Bonuses</div>
            <div className="text-lg font-bold tabular-nums">{formatMoney(data.summary.total_bonuses)}</div>
          </div>
          <div>
            <div className="text-white/60">Total Salary Increments</div>
            <div className="text-lg font-bold tabular-nums">{formatMoney(data.summary.total_increments)}</div>
          </div>
          <div>
            <div className="text-white/60">Total Deductions</div>
            <div className="text-lg font-bold tabular-nums">{formatMoney(data.summary.total_deductions)}</div>
          </div>
          <div>
            <div className="text-white/60">Grand Total Payable</div>
            <div className="text-xl font-bold tabular-nums">{formatMoney(data.summary.grand_total_payable)}</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
