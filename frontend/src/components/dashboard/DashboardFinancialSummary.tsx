import { formatMoney } from "../../utils/money";
import { dashboardSurfaces } from "./dashboardTheme";
import { DashboardSkeleton } from "./DashboardSkeleton";

type FinancialData = {
  total_revenue?: string | number;
  amount_paid?: string | number;
  outstanding_balance?: string | number;
};

const tiles = [
  { key: "revenue" as const, label: "Total revenue", field: "total_revenue" as const, valueClass: "text-[#16a34a]" },
  { key: "deposits" as const, label: "Deposits made", field: "amount_paid" as const, valueClass: "text-[var(--text-primary)]" },
  {
    key: "outstanding" as const,
    label: "Outstanding balance",
    field: "outstanding_balance" as const,
    valueClass: "text-[#d97706]"
  }
];

export function DashboardFinancialSummary({
  data,
  isLoading
}: {
  data: FinancialData | null;
  isLoading?: boolean;
}) {
  return (
    <section className={dashboardSurfaces.card}>
      <p className={dashboardSurfaces.sectionEyebrow}>Financials</p>
      <h2 className={`mt-1 ${dashboardSurfaces.sectionTitle}`}>Summary</h2>
      <p className={dashboardSurfaces.sectionDesc}>Admin totals from live order data.</p>

      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-6">
        {tiles.map((t, i) => (
          <div
            key={t.key}
            className={i > 0 ? ["md:border-l md:border-black/[0.06] md:pl-6 dark:md:border-white/[0.06]"].join(" ") : ""}
          >
            <p className="text-[11px] font-medium tracking-wide text-[var(--text-faint)]">{t.label}</p>
            <div className={`mt-2 text-3xl font-semibold tracking-tight tabular-nums sm:text-[2rem] ${t.valueClass}`}>
              {isLoading ? <DashboardSkeleton className="h-9 w-36" /> : formatMoney(data?.[t.field])}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
