import { Link } from "react-router-dom";
import type { AuditLogItem } from "../../types/api";
import { formatLagosDateTime } from "../../utils/datetime";
import { dashboardSurfaces } from "./dashboardTheme";

export function DashboardRecentActivity({
  items,
  isLoading,
  showViewAll
}: {
  items: AuditLogItem[];
  isLoading?: boolean;
  showViewAll?: boolean;
}) {
  return (
    <section className={[dashboardSurfaces.card, "flex h-full flex-col"].join(" ")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={dashboardSurfaces.sectionEyebrow}>Activity</p>
          <h2 className={`mt-1 ${dashboardSurfaces.sectionTitle}`}>Recent</h2>
          <p className={dashboardSurfaces.sectionDesc}>Latest system events</p>
        </div>
        {showViewAll ? (
          <Link to="/admin/activity" className={dashboardSurfaces.link}>
            View all
          </Link>
        ) : null}
      </div>

      <ul className="mt-6 flex flex-1 flex-col divide-y divide-black/[0.06] dark:divide-white/[0.06]">
        {isLoading ? (
          <li className="py-8 text-[13px] text-[var(--text-muted)]">Loading…</li>
        ) : items.length === 0 ? (
          <li className="py-12 text-center text-[13px] text-[var(--text-muted)]">No recent activity</li>
        ) : (
          items.map((r) => (
            <li key={r.id} className="py-3.5 first:pt-0 last:pb-0">
              <p className="text-[14px] font-medium text-[var(--text-primary)]">{r.action}</p>
              <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
                {r.entity_type}
                {r.entity_id != null ? ` #${r.entity_id}` : ""}
                {r.actor ? ` · ${r.actor}` : ""}
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-faint)]">{formatLagosDateTime(r.created_at)}</p>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
