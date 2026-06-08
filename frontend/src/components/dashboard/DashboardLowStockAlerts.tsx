import { Link } from "react-router-dom";
import type { InventoryMaterial, InventoryStockLevel } from "../../types/api";
import { dashboardSurfaces } from "./dashboardTheme";

function severityFor(level: InventoryStockLevel): { label: string; className: string } {
  if (level === "low") {
    return { label: "Critical", className: "bg-[#dc2626] text-white" };
  }
  if (level === "medium") {
    return { label: "Low", className: "bg-[#d97706] text-white" };
  }
  return { label: "OK", className: "bg-black/10 text-[var(--text-primary)]" };
}

export function DashboardLowStockAlerts({
  materials,
  isLoading
}: {
  materials: InventoryMaterial[];
  isLoading?: boolean;
}) {
  const lowItems = materials.filter((m) => m.stock_level === "low" || m.stock_level === "medium");

  return (
    <section className={[dashboardSurfaces.card, "flex h-full flex-col"].join(" ")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={dashboardSurfaces.sectionEyebrow}>Inventory</p>
          <h2 className={`mt-1 ${dashboardSurfaces.sectionTitle}`}>Low stock</h2>
          <p className={dashboardSurfaces.sectionDesc}>Materials needing attention</p>
        </div>
        <Link to="/inventory" className={dashboardSurfaces.link}>
          Open
        </Link>
      </div>

      <ul className="mt-6 flex flex-1 flex-col divide-y divide-black/[0.06] dark:divide-white/[0.06]">
        {isLoading ? (
          <li className="py-8 text-[13px] text-[var(--text-muted)]">Loading…</li>
        ) : lowItems.length === 0 ? (
          <li className="py-12 text-center text-[13px] text-[var(--text-muted)]">All stock levels healthy</li>
        ) : (
          lowItems.slice(0, 6).map((m) => {
            const sev = severityFor(m.stock_level);
            const qty =
              m.tracking_mode === "numeric" && m.quantity != null
                ? `${m.quantity} ${m.unit}`
                : m.stock_level.replace("_", " ");
            return (
              <li key={m.id} className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-[var(--text-primary)]">{m.material_name}</p>
                  <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">Remaining: {qty}</p>
                </div>
                <span
                  className={[
                    "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    sev.className
                  ].join(" ")}
                >
                  {sev.label}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
