import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui/Card";
import { dashboardApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { StatusBadge } from "../components/ui/StatusBadge";
import { useAuth } from "../state/auth";
import { formatMoney } from "../utils/money";
import { APP_NAME } from "../config/app";
import { env } from "../env";

export function DashboardPage() {
  const toast = useToast();
  const auth = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardApi.get>> | null>(null);

  const items = useMemo(
    () => [
      { label: "Total Orders", value: data?.total_orders ?? 0 },
      { label: "Total Customers", value: data?.total_customers ?? 0 },
      { label: "Pending Orders", value: data?.pending_orders ?? 0 },
      { label: "Orders In Progress", value: data?.in_progress_orders ?? 0 },
      { label: "Completed Orders", value: data?.completed_orders ?? 0 }
    ],
    [data]
  );

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

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-4">
          <img
            src={env.logoUrl || "/logo.png"}
            alt={`${APP_NAME} logo`}
            className="h-[84px] w-auto shrink-0 object-contain md:h-[92px]"
          />
          <div className="min-w-0">
            <div className="text-2xl font-bold tracking-tight">Dashboard</div>
            <div className="mt-1 text-sm text-black/60">Business insights for {APP_NAME}.</div>
            {auth.username ? (
              <div className="mt-1 text-sm font-semibold text-black/70">Signed in as {auth.username}</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
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
          <div className="mt-4 overflow-x-auto">
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

