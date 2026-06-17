import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { MonthlyEmployeeAttendanceCard } from "../components/employee/MonthlyEmployeeAttendanceCard";
import { useMonthlyEmployeeAttendance } from "../hooks/useMonthlyEmployeeAttendance";
import { usePageHeader } from "../components/layout/pageHeader";
import { expensesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import type { ExpenseEntry, ExpenseSummary } from "../types/api";
import { formatLagosDateTime } from "../utils/datetime";
import { formatMoney } from "../utils/money";

type ActivityItem =
  | { kind: "attendance"; at: string; label: string }
  | { kind: "petty_cash"; at: string; label: string; amount: string | number; entryType: string };

export function FinanceRoleDashboardPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const attendance = useMonthlyEmployeeAttendance();
  const [pettyLoading, setPettyLoading] = useState(true);
  const [pettyRows, setPettyRows] = useState<ExpenseEntry[]>([]);
  const [pettySummary, setPettySummary] = useState<ExpenseSummary | null>(null);

  usePageHeader({
    title: "Finance Dashboard",
    subtitle: "Attendance and petty cash."
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setPettyLoading(true);
      try {
        const [page, summary] = await Promise.all([
          expensesApi.page({ limit: 8, offset: 0 }),
          expensesApi.summary()
        ]);
        if (!alive) return;
        setPettyRows(page.items);
        setPettySummary(summary);
      } catch (e) {
        if (alive) toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setPettyLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  const recentActivity = useMemo(() => {
    const items: ActivityItem[] = [];

    for (const row of attendance.attendance.slice(0, 6)) {
      const at = row.check_in_at ?? row.attendance_date;
      if (!at) continue;
      const parts: string[] = [];
      if (row.check_in_at) parts.push(`Checked in ${formatLagosDateTime(row.check_in_at)}`);
      if (row.check_out_at) parts.push(`Checked out ${formatLagosDateTime(row.check_out_at)}`);
      const locationName = row.work_location?.name;
      if (locationName) parts.push(`Location: ${locationName}`);
      items.push({
        kind: "attendance",
        at: String(at),
        label: parts.length ? parts.join(" · ") : "Attendance recorded"
      });
    }

    for (const row of pettyRows.slice(0, 6)) {
      items.push({
        kind: "petty_cash",
        at: row.entry_date,
        label: row.note?.trim() || (row.entry_type === "credit" ? "Petty cash credit" : "Petty cash expense"),
        amount: row.amount,
        entryType: row.entry_type
      });
    }

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return items.slice(0, 8);
  }, [attendance.attendance, pettyRows]);

  return (
    <div className="space-y-6">
      <MonthlyEmployeeAttendanceCard
        empLoading={attendance.empLoading}
        emp={attendance.emp}
        attendance={attendance.attendance}
        attBusy={attendance.attBusy}
        clockRes={attendance.clockRes}
        clockOutRes={attendance.clockOutRes}
        todayEntry={attendance.todayEntry}
        checkInAllowed={attendance.checkInAllowed}
        checkOutAllowed={attendance.checkOutAllowed}
        dayCompleted={attendance.dayCompleted}
        onMarkAttendanceWithShift={attendance.markAttendance}
        onRequestMarkAttendance={attendance.requestMarkAttendance}
        onSignOutAttendance={attendance.signOutAttendance}
        onRequestSignOut={attendance.requestSignOut}
        shiftModalOpen={attendance.shiftModalOpen}
        onShiftModalClose={() => attendance.setShiftModalOpen(false)}
        signOutConfirmOpen={attendance.signOutConfirmOpen}
        signOutPreview={attendance.signOutPreview}
        onSignOutConfirmClose={() => attendance.setSignOutConfirmOpen(false)}
        resultFeedback={attendance.resultFeedback}
        onDismissResultFeedback={attendance.dismissResultFeedback}
        missingProfileMessage="No employee profile is linked to your account yet. Ask an administrator to link your Finance login."
        showHistory
      />

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-black">Petty Cash</div>
            <div className="mt-0.5 text-xs text-black/60">Balances and recent transactions</div>
          </div>
          <Button variant="secondary" onClick={() => navigate("/expenses")}>
            Open Petty Cash
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Balance</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(pettySummary?.balance ?? 0)}</div>
          </Card>
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Total received</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(pettySummary?.total_received ?? 0)}</div>
          </Card>
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Total expenses</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-red-800">{formatMoney(pettySummary?.total_expenses ?? 0)}</div>
          </Card>
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Today&apos;s expenses</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(pettySummary?.today_total ?? 0)}</div>
          </Card>
        </div>

        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-black/55">Recent transactions</div>
          {pettyLoading ? (
            <div className="mt-3 text-sm text-black/60">Loading petty cash…</div>
          ) : pettyRows.length === 0 ? (
            <div className="mt-3 text-sm text-black/60">No petty cash entries yet.</div>
          ) : (
            <div className="mt-3 divide-y divide-black/5 rounded-2xl border border-black/10">
              {pettyRows.slice(0, 5).map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{row.note?.trim() || "—"}</div>
                    <div className="mt-0.5 text-xs text-black/60">
                      {new Date(row.entry_date).toLocaleDateString()} · {row.entry_type === "credit" ? "Credit" : "Expense"}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-bold tabular-nums">
                    {row.entry_type === "expense" ? "−" : "+"}
                    {formatMoney(row.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">Recent activity</div>
        <div className="mt-0.5 text-xs text-black/60">Attendance actions and petty cash updates</div>
        {recentActivity.length === 0 ? (
          <div className="mt-4 text-sm text-black/60">No recent activity yet.</div>
        ) : (
          <div className="mt-4 divide-y divide-black/5 rounded-2xl border border-black/10">
            {recentActivity.map((item, idx) => (
              <div key={`${item.kind}-${item.at}-${idx}`} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-black/50">
                    {item.kind === "attendance" ? "Attendance" : "Petty cash"}
                  </div>
                  <div className="mt-1 text-sm text-black/80">{item.label}</div>
                </div>
                {"amount" in item ? (
                  <div className="shrink-0 text-sm font-bold tabular-nums">
                    {item.entryType === "expense" ? "−" : "+"}
                    {formatMoney(item.amount)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
