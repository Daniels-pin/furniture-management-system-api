import { Link } from "react-router-dom";
import type { OrderStatus } from "../../types/api";
import { StatusBadge } from "../ui/StatusBadge";
import { dashboardSurfaces } from "./dashboardTheme";

type RecentOrder = {
  order_id: number;
  status: OrderStatus;
  due_date?: string | null;
  customer: { name: string | null } | null;
};

export function DashboardRecentOrders({
  orders,
  isLoading
}: {
  orders: RecentOrder[];
  isLoading?: boolean;
}) {
  return (
    <section className={[dashboardSurfaces.card, "flex h-full flex-col"].join(" ")}>
      <p className={dashboardSurfaces.sectionEyebrow}>Orders</p>
      <h2 className={`mt-1 ${dashboardSurfaces.sectionTitle}`}>Recent</h2>
      <p className={dashboardSurfaces.sectionDesc}>Last five orders</p>

      <div className="mt-6 min-w-0 flex-1 overflow-x-touch">
        <table className="w-full min-w-[420px] text-left text-[13px]">
          <thead>
            <tr className="text-[var(--text-faint)]">
              <th className="pb-3 pr-4 text-[11px] font-medium uppercase tracking-wide">Order</th>
              <th className="pb-3 pr-4 text-[11px] font-medium uppercase tracking-wide">Customer</th>
              <th className="pb-3 pr-4 text-[11px] font-medium uppercase tracking-wide">Status</th>
              <th className="pb-3 text-[11px] font-medium uppercase tracking-wide">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-[var(--text-muted)]">
                  Loading…
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-[var(--text-muted)]">
                  No recent orders.
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.order_id} className="group">
                  <td className="py-3.5 pr-4">
                    <Link
                      to={`/orders/${o.order_id}`}
                      className="font-semibold text-[var(--text-primary)] hover:underline"
                    >
                      #{o.order_id}
                    </Link>
                  </td>
                  <td className="py-3.5 pr-4 text-[var(--text-muted)]">{o.customer?.name ?? "—"}</td>
                  <td className="py-3.5 pr-4">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="py-3.5 tabular-nums text-[var(--text-muted)]">
                    {o.due_date ? new Date(o.due_date).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
