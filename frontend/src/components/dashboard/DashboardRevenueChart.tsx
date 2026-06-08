import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { dashboardAccents, dashboardSurfaces } from "./dashboardTheme";
import { buildPlaceholderMonthlyRevenue } from "./dashboardUtils";
import { DashboardSkeleton } from "./DashboardSkeleton";

export function DashboardRevenueChart({
  isLoading,
  monthlyData
}: {
  isLoading?: boolean;
  monthlyData?: Array<{ month: string; revenue: number }>;
}) {
  const data = monthlyData ?? buildPlaceholderMonthlyRevenue();
  const hasRealData = Boolean(monthlyData?.some((d) => d.revenue > 0));

  return (
    <section className={[dashboardSurfaces.card, "flex min-h-[300px] flex-col"].join(" ")}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className={dashboardSurfaces.sectionEyebrow}>Revenue</p>
          <h2 className={`mt-1 ${dashboardSurfaces.sectionTitle}`}>Trend</h2>
          <p className={dashboardSurfaces.sectionDesc}>Last 12 months</p>
        </div>
        {!hasRealData ? (
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">Preview</span>
        ) : null}
      </div>

      <div className="mt-6 min-h-0 flex-1">
        {isLoading ? (
          <DashboardSkeleton className="h-[220px] w-full rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={dashboardAccents.green} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={dashboardAccents.green} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "none",
                  borderRadius: "10px",
                  boxShadow: "var(--shadow-elevated)",
                  fontSize: "12px"
                }}
                formatter={(value: number) => [
                  value.toLocaleString(undefined, { maximumFractionDigits: 0 }),
                  "Revenue"
                ]}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke={dashboardAccents.green}
                strokeWidth={1.5}
                fill="url(#revenueFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
