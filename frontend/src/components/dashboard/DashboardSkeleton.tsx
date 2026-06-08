import { dashboardSurfaces } from "./dashboardTheme";

export function DashboardSkeleton({ className }: { className?: string }) {
  return <div className={[dashboardSurfaces.skeleton, className || "h-8 w-24"].join(" ")} aria-hidden />;
}

export function DashboardCardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className={[dashboardSurfaces.card, "flex min-h-[108px] flex-col justify-center gap-3"].join(" ")}>
      <DashboardSkeleton className="h-3 w-24" />
      {Array.from({ length: lines }).map((_, i) => (
        <DashboardSkeleton key={i} className={i === lines - 1 ? "h-10 w-16" : "h-3 w-full max-w-[140px]"} />
      ))}
    </div>
  );
}
