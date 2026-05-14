import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui/Card";
import { employeesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { usePageHeader } from "../components/layout/pageHeader";
import type { EmployeeDetail, EmployeeTransaction } from "../types/api";
import { MonthlyEmployeeFinancePanel } from "../components/employee/MonthlyEmployeeFinancePanel";
import { formatMoney } from "../utils/money";
import { sanitizeMoneyInput } from "../utils/moneyInput";

export function StaffFinanceSelf() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [emp, setEmp] = useState<EmployeeDetail | null>(null);
  const [txns, setTxns] = useState<EmployeeTransaction[]>([]);

  usePageHeader({
    title: "Finance",
    subtitle: "Your salary and payment history for the active payroll month."
  });

  const paidThisPeriod = useMemo(() => {
    let s = 0;
    for (const t of txns) {
      if (t.txn_type === "payment" && t.status === "paid") {
        const n = Number(sanitizeMoneyInput(String(t.amount)));
        if (Number.isFinite(n)) s += n;
      }
    }
    return s;
  }, [txns]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const me = await employeesApi.getMe();
        if (!alive) return;
        setEmp(me);
        try {
          const rows = await employeesApi.myTransactions({
            period_year: me.period.year,
            period_month: me.period.month
          });
          if (alive) setTxns(rows);
        } catch {
          if (alive) setTxns([]);
        }
      } catch (e) {
        if (!alive) return;
        setEmp(null);
        toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  if (loading) {
    return (
      <Card>
        <div className="text-sm text-black/60">Loading…</div>
      </Card>
    );
  }

  if (!emp) {
    return (
      <Card>
        <div className="text-lg font-bold tracking-tight">Finance</div>
        <p className="mt-2 text-sm text-black/70">
          No employee profile is linked to your account yet. Ask an administrator to create your record and link your user.
        </p>
      </Card>
    );
  }

  const finalNum = Number(sanitizeMoneyInput(String(emp.salary.final_payable)));
  const finalOk = Number.isFinite(finalNum) ? finalNum : 0;
  const outstanding = Math.max(0, finalOk - paidThisPeriod);

  return (
    <div className="space-y-6">
      <Card>
        <div className="text-sm font-semibold text-black">Summary</div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Final payable (period)</div>
            <div className="mt-1 font-bold tabular-nums">{formatMoney(emp.salary.final_payable)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Total paid</div>
            <div className="mt-1 font-bold tabular-nums text-emerald-800">{formatMoney(paidThisPeriod)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Outstanding</div>
            <div className="mt-1 font-bold tabular-nums text-amber-900">{formatMoney(outstanding)}</div>
          </div>
        </div>
      </Card>

      <MonthlyEmployeeFinancePanel emp={emp} />

      <Card>
        <div className="text-sm font-semibold text-black">Late penalties (this period)</div>
        {emp.lateness_entries.length === 0 ? (
          <p className="mt-2 text-sm text-black/60">No lateness entries.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {emp.lateness_entries.map((x) => (
              <li key={x.id} className="rounded-xl border border-black/10 px-3 py-2 text-sm">
                <div className="font-semibold">{x.note || "Lateness"}</div>
                <div className="mt-0.5 text-xs text-black/55">{new Date(x.created_at).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">Other deductions and bonuses</div>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold text-black/60">Penalties</div>
            {emp.penalties.length === 0 ? (
              <p className="mt-1 text-sm text-black/60">None</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {emp.penalties.map((p) => (
                  <li key={p.id} className="rounded-xl border border-black/10 px-3 py-2 text-sm">
                    <div className="font-semibold">{p.description}</div>
                    <div className="text-xs text-red-800">−{formatMoney(p.amount)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold text-black/60">Bonuses</div>
            {emp.bonuses.length === 0 ? (
              <p className="mt-1 text-sm text-black/60">None</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {emp.bonuses.map((b) => (
                  <li key={b.id} className="rounded-xl border border-black/10 px-3 py-2 text-sm">
                    <div className="font-semibold">{b.description}</div>
                    <div className="text-xs text-emerald-800">+{formatMoney(b.amount)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">Payment history ({emp.period.label})</div>
        {txns.length === 0 ? (
          <p className="mt-2 text-sm text-black/60">No ledger entries for this period yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-black/60">
                <tr className="border-b border-black/10">
                  <th className="py-2 pr-3 font-semibold">Date</th>
                  <th className="py-2 pr-3 font-semibold">Type</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-0 font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-b border-black/5">
                    <td className="py-2 pr-3 text-black/80">{new Date(t.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-3 font-semibold">{t.txn_type}</td>
                    <td className="py-2 pr-3">{t.status}</td>
                    <td className="py-2 pr-0 tabular-nums font-semibold">{formatMoney(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
