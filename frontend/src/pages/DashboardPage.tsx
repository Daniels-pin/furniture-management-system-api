import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui/Card";
import { dashboardApi, employeesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { StatusBadge } from "../components/ui/StatusBadge";
import { useAuth } from "../state/auth";
import { formatMoney } from "../utils/money";
import { APP_NAME } from "../config/app";
import { usePageHeader } from "../components/layout/pageHeader";
import { Button } from "../components/ui/Button";
import type { EmployeeAttendanceEntry, EmployeeClockInResponse, EmployeeDetail } from "../types/api";

export function DashboardPage() {
  const toast = useToast();
  const auth = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardApi.get>> | null>(null);
  const [empLoading, setEmpLoading] = useState(true);
  const [emp, setEmp] = useState<EmployeeDetail | null>(null);
  const [attBusy, setAttBusy] = useState(false);
  const [attendance, setAttendance] = useState<EmployeeAttendanceEntry[]>([]);
  const [clockRes, setClockRes] = useState<EmployeeClockInResponse | null>(null);

  usePageHeader({
    title: "Dashboard",
    subtitle: `Business insights for ${APP_NAME}.`
  });

  const items = useMemo(() => {
    const rows = [
      { label: "Total Orders", value: data?.total_orders ?? 0 },
      { label: "Pending Orders", value: data?.pending_orders ?? 0 },
      { label: "Orders In Progress", value: data?.in_progress_orders ?? 0 },
      { label: "Completed Orders", value: data?.completed_orders ?? 0 }
    ];
    if (auth.role !== "factory") {
      rows.splice(1, 0, { label: "Total Customers", value: data?.total_customers ?? 0 });
    }
    return rows;
  }, [data, auth.role]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setIsLoading(true);
      try {
        const res = await dashboardApi.get();
        if (!alive) return;
        setData(res);
      } catch (err) {
        toast.push("error", getErrorMessage(err));
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  useEffect(() => {
    // Monthly employees should see attendance immediately on dashboard.
    // We detect this by whether /employees/me exists for the logged-in user.
    let alive = true;
    (async () => {
      setEmpLoading(true);
      setEmp(null);
      setAttendance([]);
      try {
        const me = await employeesApi.getMe();
        if (!alive) return;
        setEmp(me);
        try {
          const rows = await employeesApi.myAttendance({ limit: 30, offset: 0 });
          if (alive) setAttendance(rows);
        } catch {
          // non-fatal
        }
      } catch (e: any) {
        // Not a linked monthly employee (or not authorized) → silently ignore on dashboard.
        if (!alive) return;
        setEmp(null);
      } finally {
        if (alive) setEmpLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [auth.token]);

  async function refreshAttendance() {
    try {
      const rows = await employeesApi.myAttendance({ limit: 30, offset: 0 });
      setAttendance(rows);
    } catch {
      // ignore
    }
  }

  async function markAttendance() {
    setAttBusy(true);
    try {
      const res = await employeesApi.clockInAttendance();
      setClockRes(res);
      await refreshAttendance();
      if (res.status === "already_marked") {
        toast.push("success", res.message || "Attendance already marked.");
      } else if (res.status === "sunday") {
        toast.push("success", res.message || "No attendance required today.");
      } else if (res.status === "late") {
        toast.push("success", "Attendance marked (Late). ₦500 lateness deduction applied.");
      } else {
        toast.push("success", "Attendance marked.");
      }
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setAttBusy(false);
    }
  }

  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const todayEntry = attendance.find((a) => a.attendance_date === todayKey) ?? null;

  return (
    <div className="space-y-6">
      {!empLoading && emp ? (
        <Card>
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              <div className="text-sm font-semibold text-black">Attendance</div>
              <p className="mt-1 text-xs text-black/55">Mark attendance. Late coming attracts a ₦500 deduction.</p>
            </div>
            <Button isLoading={attBusy} disabled={attBusy || Boolean(todayEntry)} onClick={() => void markAttendance()}>
              {todayEntry ? "Attendance already marked" : "Mark Attendance"}
            </Button>
          </div>

          {todayEntry ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={[
                  "rounded-full px-2 py-0.5 font-semibold",
                  todayEntry.is_late ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"
                ].join(" ")}
              >
                {todayEntry.is_late ? "Late" : "Present"}
              </span>
              <span className="text-black/60">
                {new Date(todayEntry.check_in_at).toLocaleString()}
                {todayEntry.is_late && typeof todayEntry.late_minutes === "number" ? ` · ${todayEntry.late_minutes} min late` : ""}
              </span>
            </div>
          ) : clockRes?.status === "sunday" ? (
            <div className="mt-3 text-sm font-semibold text-black/70">{clockRes.message ?? "Sundays are excluded."}</div>
          ) : null}

          {attendance.length ? (
            <div className="mt-4">
              <div className="text-xs font-semibold text-black/60">Recent attendance</div>
              <ul className="mt-2 space-y-2">
                {attendance.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-semibold">{a.attendance_date}</div>
                      <div className="text-xs text-black/60">{new Date(a.check_in_at).toLocaleTimeString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          a.is_late ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"
                        ].join(" ")}
                      >
                        {a.is_late ? "Late" : "Present"}
                      </span>
                      {a.is_late ? <span className="text-xs font-semibold text-red-800">₦500</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div
        className={[
          "grid grid-cols-1 gap-4",
          auth.role === "factory" ? "md:grid-cols-4" : "md:grid-cols-5"
        ].join(" ")}
      >
        {items.map((x) => (
          <Card key={x.label}>
            <div className="text-sm font-semibold text-black/60">{x.label}</div>
            <div className="mt-2 text-4xl font-bold tracking-tight">
              {isLoading ? <span className="text-black/20">—</span> : x.value}
            </div>
          </Card>
        ))}
      </div>

      {auth.role === "admin" ? (
        <Card>
          <div className="text-sm font-semibold">Financial summary</div>
          <div className="mt-1 text-sm text-black/60">Visible to admin only.</div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
              <div className="text-xs font-semibold text-black/60">Total Revenue</div>
              <div className="mt-1 text-sm font-semibold">{formatMoney(data?.total_revenue)}</div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
              <div className="text-xs font-semibold text-black/60">Deposits made</div>
              <div className="mt-1 text-sm font-semibold">{formatMoney(data?.amount_paid)}</div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
              <div className="text-xs font-semibold text-black/60">Outstanding Balance</div>
              <div className="mt-1 text-sm font-semibold">{formatMoney(data?.outstanding_balance)}</div>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="text-sm font-semibold">Upcoming Due Orders</div>
          <div className="mt-1 text-sm text-black/60">Due within 14 days (max 5).</div>
          <div className="mt-4 space-y-2">
            {isLoading ? (
              <div className="text-sm text-black/60">Loading…</div>
            ) : !data || data.upcoming_due_orders.length === 0 ? (
              <div className="text-sm text-black/60">No upcoming due orders</div>
            ) : (
              data.upcoming_due_orders.map((o, idx) => (
                <div
                  key={o.order_id}
                  className="flex items-center justify-between rounded-2xl border border-black/10 bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">
                      #{String(idx + 1).padStart(3, "0")}
                      <span className="ml-2 text-black/60">(Order {o.order_id})</span>
                    </div>
                    <div className="mt-0.5 text-xs text-black/60">
                      Due: {o.due_date ? new Date(o.due_date).toLocaleDateString() : "—"}
                      {o.customer?.name ? ` • ${o.customer.name}` : ""}
                    </div>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <div className="text-sm font-semibold">Recent Orders</div>
          <div className="mt-1 text-sm text-black/60">Last 5 orders.</div>
          <div className="mt-4 min-w-0 overflow-x-touch">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-black/60">
                <tr className="border-b border-black/10">
                  <th className="py-3 pr-4 font-semibold">Order</th>
                  <th className="py-3 pr-4 font-semibold">Status</th>
                  <th className="py-3 pr-0 font-semibold">Due date</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="py-6 text-black/60" colSpan={3}>
                      Loading…
                    </td>
                  </tr>
                ) : !data || data.recent_orders.length === 0 ? (
                  <tr>
                    <td className="py-6 text-black/60" colSpan={3}>
                      No recent orders.
                    </td>
                  </tr>
                ) : (
                  data.recent_orders.map((o, idx) => (
                    <tr key={o.order_id} className="border-b border-black/5">
                      <td className="py-3 pr-4 font-semibold">
                        #{String(idx + 1).padStart(3, "0")}
                        <span className="ml-2 text-black/60">(Order {o.order_id})</span>
                        {o.customer?.name ? (
                          <span className="ml-2 text-black/50">• {o.customer.name}</span>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="py-3 pr-0 text-black/70">
                        {o.due_date ? new Date(o.due_date).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

