import { DashboardKpiCard } from "./DashboardKpiCard";
import { DashboardCardSkeleton } from "./DashboardSkeleton";

export function DashboardKpiGrid({
  items,
  isLoading,
  columnClass
}: {
  items: Array<{ label: string; value: number }>;
  isLoading?: boolean;
  columnClass: string;
}) {
  if (isLoading) {
    return (
      <div className={["grid grid-cols-1 gap-5", columnClass].join(" ")}>
        {items.map((x) => (
          <DashboardCardSkeleton key={x.label} />
        ))}
      </div>
    );
  }

  return (
    <div className={["grid grid-cols-1 gap-5", columnClass].join(" ")}>
      {items.map((x) => (
        <DashboardKpiCard key={x.label} label={x.label} value={x.value} isLoading={isLoading} />
      ))}
    </div>
  );
}
