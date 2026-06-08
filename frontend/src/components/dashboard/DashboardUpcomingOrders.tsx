import { Link } from "react-router-dom";
import type { OrderStatus } from "../../types/api";
import { StatusBadge } from "../ui/StatusBadge";
import { dashboardSurfaces } from "./dashboardTheme";
import {
  dueUrgencyClasses,
  dueUrgencyLabel,
  getDueUrgency,
  orderProgressFromStatus
} from "./dashboardUtils";

type UpcomingOrder = {
  order_id: number;
  status: OrderStatus;
  due_date?: string | null;
  customer: { name: string | null } | null;
};

export function DashboardUpcomingOrders({
  orders,
  isLoading
}: {
  orders: UpcomingOrder[];
  isLoading?: boolean;
}) {
  return (
    <section className={[dashboardSurfaces.card, "flex h-full flex-col"].join(" ")}>
      <p className={dashboardSurfaces.sectionEyebrow}>Schedule</p>
      <h2 className={`mt-1 ${dashboardSurfaces.sectionTitle}`}>Upcoming due</h2>
      <p className={dashboardSurfaces.sectionDesc}>Due within 14 days</p>

      <div className="mt-6 flex flex-1 flex-col">
        {isLoading ? (
          <p className="py-8 text-[13px] text-[var(--text-muted)]">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-[var(--text-muted)]">No upcoming due orders</p>
        ) : (
          <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {orders.map((o) => {
              const urgency = getDueUrgency(o.due_date);
              const urgencyLabel = dueUrgencyLabel(urgency);
              const progress = orderProgressFromStatus(o.status);
              return (
                <li key={o.order_id}>
                  <Link
                    to={`/orders/${o.order_id}`}
                    className={[
                      "block py-4 transition-colors first:pt-0 last:pb-0",
                      dueUrgencyClasses(urgency),
                      urgency !== "normal" ? "rounded-lg px-3 -mx-3" : ""
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                            Order #{o.order_id}
                          </span>
                          {urgencyLabel ? (
                            <span
                              className={[
                                "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                urgency === "overdue" ? "bg-[#dc2626] text-white" : "bg-[#d97706] text-white"
                              ].join(" ")}
                            >
                              {urgencyLabel}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                          Due{" "}
                          {o.due_date
                            ? new Date(o.due_date).toLocaleDateString(undefined, { dateStyle: "medium" })
                            : "—"}
                          {o.customer?.name ? ` · ${o.customer.name}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={o.status} />
                    </div>
                    <div className="mt-3">
                      <div className="mb-1.5 flex justify-between text-[11px] text-[var(--text-faint)]">
                        <span>Progress</span>
                        <span className="tabular-nums">{progress}%</span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
                        <div
                          className="h-full rounded-full bg-[#16a34a] transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
