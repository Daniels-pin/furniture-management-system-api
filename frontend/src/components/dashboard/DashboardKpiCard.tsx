import { dashboardSurfaces } from "./dashboardTheme";

export function DashboardKpiCard({
  label,
  value,
  isLoading
}: {
  label: string;
  value: number | string;
  isLoading?: boolean;
}) {
  return (
    <div className={[dashboardSurfaces.card, "flex min-h-[108px] flex-col justify-center"].join(" ")}>
      <p className="text-[11px] font-medium tracking-wide text-[var(--text-faint)]">{label}</p>
      <p className="mt-2 text-4xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums sm:text-[2.5rem]">
        {isLoading ? <span className="text-[var(--text-faint)]">—</span> : value}
      </p>
    </div>
  );
}
