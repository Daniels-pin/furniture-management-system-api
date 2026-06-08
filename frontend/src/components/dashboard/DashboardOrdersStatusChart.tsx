import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { dashboardAccents, dashboardSurfaces } from "./dashboardTheme";
import { DashboardSkeleton } from "./DashboardSkeleton";

const SLICE_COLORS = [dashboardAccents.amber, dashboardAccents.black, dashboardAccents.green];

export function DashboardOrdersStatusChart({
  pending,
  inProgress,
  completed,
  isLoading
}: {
  pending: number;
  inProgress: number;
  completed: number;
  isLoading?: boolean;
}) {
  const chartData = [
    { name: "Pending", value: pending },
    { name: "In progress", value: inProgress },
    { name: "Completed", value: completed }
  ];
  const total = pending + inProgress + completed;

  return (
    <section className={[dashboardSurfaces.card, "flex min-h-[300px] flex-col"].join(" ")}>
      <p className={dashboardSurfaces.sectionEyebrow}>Orders</p>
      <h2 className={`mt-1 ${dashboardSurfaces.sectionTitle}`}>Status</h2>
      <p className={dashboardSurfaces.sectionDesc}>Breakdown from dashboard counts</p>

      <div className="mt-4 flex flex-1 flex-col items-center gap-6 sm:flex-row sm:items-center">
        <div className="h-[200px] w-full max-w-[200px] shrink-0">
          {isLoading ? (
            <DashboardSkeleton className="mx-auto h-[180px] w-[180px] rounded-full" />
          ) : total === 0 ? (
            <div className="flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]">No order data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={1}
                  strokeWidth={0}
                >
                  {chartData.map((entry, i) => (
                    <Cell key={entry.name} fill={SLICE_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    border: "none",
                    borderRadius: "10px",
                    boxShadow: "var(--shadow-elevated)",
                    fontSize: "12px"
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <ul className="flex w-full flex-1 flex-col gap-4 sm:max-w-[220px]">
          {chartData.map((row, i) => (
            <li key={row.name} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex items-center gap-2.5 text-[var(--text-muted)]">
                <span className="h-2 w-2 rounded-full" style={{ background: SLICE_COLORS[i] }} aria-hidden />
                {row.name}
              </span>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                {isLoading ? "—" : row.value}
              </span>
            </li>
          ))}
          <li className={`flex justify-between pt-4 text-[13px] font-medium ${dashboardSurfaces.divider}`}>
            <span className="text-[var(--text-muted)]">Total</span>
            <span className="tabular-nums text-[var(--text-primary)]">{isLoading ? "—" : total}</span>
          </li>
        </ul>
      </div>
    </section>
  );
}
