import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Button } from "../components/ui/Button";
import { PaginationFooter } from "../components/ui/Pagination";
import { AttendanceAdjustModal } from "../components/employee/AttendanceAdjustModal";
import { AttendanceDailyWaiverModal } from "../components/employee/AttendanceDailyWaiverModal";
import { employeesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { usePageHeader } from "../components/layout/pageHeader";
import { useCompanyLocations } from "../query/hooks";
import { useAuth } from "../state/auth";
import { hasAdminAccess } from "../utils/roles";
import type { AttendanceMonitorFilterStatus, AttendanceMonitorRow } from "../types/api";
import {
  attendanceMonitorStatusBadgeClass,
  attendanceMonitorStatusLabel,
  attendanceTodayKey,
  attendanceWaivedBadgeClass,
  attendanceWaivedBadgeLabel,
  formatWaiverTooltip
} from "../utils/attendance";
import { formatLagosTime } from "../utils/datetime";
import { formatMoney } from "../utils/money";
import {
  DataListCard,
  DataListMetric,
  ResponsiveDataList,
  ScrollTable
} from "../components/ui/responsive";

const POLL_VISIBLE_MS = 15_000;
const POLL_HIDDEN_MS = 60_000;
const PAGE_SIZE = 50;

const STATUS_OPTIONS: { value: "" | AttendanceMonitorFilterStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "early_sign_out", label: "Early Sign-Out" },
  { value: "absent", label: "Absent" },
  { value: "checked_in", label: "Checked In Only" },
  { value: "incomplete_day", label: "Incomplete Day" }
];

function SummaryMetric({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-black/50">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{count}</div>
    </div>
  );
}

function monitorPollMs(): number {
  if (typeof document === "undefined") return POLL_VISIBLE_MS;
  return document.visibilityState === "hidden" ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
}

export function AttendanceRecordsPage() {
  const toast = useToast();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = hasAdminAccess(auth.role);
  const defaultDate = useMemo(() => attendanceTodayKey(), []);
  const [viewDate, setViewDate] = useState(defaultDate);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | AttendanceMonitorFilterStatus>("");
  const [locationFilter, setLocationFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [adjustRow, setAdjustRow] = useState<AttendanceMonitorRow | null>(null);
  const [dailyWaiverOpen, setDailyWaiverOpen] = useState(false);

  const { data: locations = [] } = useCompanyLocations();

  usePageHeader({
    title: "Attendance Records",
    subtitle: "Real-time attendance overview, deduction totals, and admin waiver tools."
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchDebounced(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [searchDebounced, statusFilter, locationFilter, viewDate]);

  const monitorQuery = useQuery({
    queryKey: ["attendance-monitor", viewDate, searchDebounced, statusFilter, locationFilter, page],
    queryFn: () =>
      employeesApi.attendanceMonitor({
        date: viewDate,
        search: searchDebounced || undefined,
        status: statusFilter || undefined,
        location_id: locationFilter ? Number(locationFilter) : undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE
      }),
    staleTime: 5_000,
    refetchInterval: monitorPollMs
  });

  useEffect(() => {
    if (monitorQuery.error) {
      toast.push("error", getErrorMessage(monitorQuery.error));
    }
  }, [monitorQuery.error, toast]);

  const monitor = monitorQuery.data ?? null;
  const loading = monitorQuery.isLoading && !monitor;
  const summary = monitor?.summary;
  const rows = monitor?.rows ?? [];
  const rowsTotal = monitor?.rows_total ?? rows.length;

  const locationOptions = useMemo(
    () => [
      { value: "", label: "All locations" },
      ...locations.map((loc) => ({ value: String(loc.id), label: loc.name }))
    ],
    [locations]
  );

  function refreshMonitor() {
    void queryClient.invalidateQueries({ queryKey: ["attendance-monitor"] });
  }

  function handleWaiverSaved() {
    toast.push("success", "Attendance deduction waiver saved.");
    refreshMonitor();
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Today&apos;s Attendance</h2>
            <p className="mt-1 text-sm text-black/60">
              {summary?.attendance_date ?? viewDate} · updates automatically
              {typeof document !== "undefined" && document.visibilityState === "hidden"
                ? " (slower refresh while tab is hidden)"
                : null}
            </p>
          </div>
          {isAdmin ? (
            <Button variant="secondary" onClick={() => setDailyWaiverOpen(true)}>
              Waive Entire Day
            </Button>
          ) : null}
        </div>

        <div className="mt-4 max-w-xs">
          <Input label="View date" type="date" value={viewDate} onChange={(e) => setViewDate(e.target.value)} />
        </div>

        {loading && !summary ? (
          <p className="mt-4 text-sm font-semibold text-black/55">Loading attendance summary…</p>
        ) : summary ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <SummaryMetric label="Expected Employees" count={summary.expected_employees} />
            <SummaryMetric label="Present" count={summary.present} />
            <SummaryMetric label="Late" count={summary.late} />
            <SummaryMetric label="Early Sign-Out" count={summary.early_sign_out} />
            <SummaryMetric label="Absent" count={summary.absent} />
            <SummaryMetric label="Checked In Only" count={summary.checked_in_only} />
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            label="Search employee"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | AttendanceMonitorFilterStatus)}
            options={STATUS_OPTIONS}
          />
          <Select
            label="Location"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            options={locationOptions}
          />
        </div>

        <div className="mt-5">
          <ResponsiveDataList
            mobile={
              rows.length === 0 ? (
                <div className="text-center text-sm font-semibold text-black/55">
                  {loading ? "Loading employees…" : "No employees match your filters."}
                </div>
              ) : (
                rows.map((row) => {
                  const waivedLabel = attendanceWaivedBadgeLabel(row);
                  return (
                    <DataListCard
                      key={row.employee_id}
                      title={row.full_name}
                      subtitle={row.work_location?.name ?? "—"}
                      badge={
                        <div className="flex flex-wrap justify-end gap-1">
                          <span
                            className={[
                              "rounded-full px-2 py-0.5 text-xs font-semibold",
                              attendanceMonitorStatusBadgeClass(row.status)
                            ].join(" ")}
                          >
                            {attendanceMonitorStatusLabel(row.status)}
                          </span>
                          {waivedLabel ? (
                            <span
                              className={[
                                "rounded-full px-2 py-0.5 text-xs font-semibold",
                                attendanceWaivedBadgeClass()
                              ].join(" ")}
                            >
                              {waivedLabel}
                            </span>
                          ) : null}
                        </div>
                      }
                      metrics={
                        <>
                          <DataListMetric label="Shift" value={row.shift_label ?? "—"} />
                          <DataListMetric
                            label="Check In"
                            value={row.check_in_at ? formatLagosTime(row.check_in_at) : "—"}
                          />
                          <DataListMetric
                            label="Check Out"
                            value={row.check_out_at ? formatLagosTime(row.check_out_at) : "—"}
                          />
                          <DataListMetric
                            label="Day Deductions"
                            value={
                              <span className="text-red-800">
                                {formatMoney(row.total_attendance_deductions_naira ?? 0)}
                              </span>
                            }
                          />
                        </>
                      }
                      actions={
                        <>
                          {isAdmin ? (
                            <Button
                              variant="secondary"
                              disabled={row.payroll_finalized || row.can_adjust_attendance === false}
                              onClick={() => setAdjustRow(row)}
                            >
                              Adjust
                            </Button>
                          ) : null}
                          <Link to={`/attendance-records/${row.employee_id}`}>
                            <Button variant="secondary">View</Button>
                          </Link>
                        </>
                      }
                    >
                      <div className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-black/70">
                        <div>Late {formatMoney(row.period_late_deduction_total_naira ?? 0)}</div>
                        <div>Early {formatMoney(row.period_early_sign_out_deduction_total_naira ?? 0)}</div>
                        <div>Abs {formatMoney(row.period_absence_deduction_total_naira ?? 0)}</div>
                        <div className="mt-1 font-bold text-red-800">
                          Month total {formatMoney(row.period_total_attendance_deductions_naira ?? 0)}
                        </div>
                      </div>
                    </DataListCard>
                  );
                })
              )
            }
            desktop={
              <ScrollTable minWidth={1200}>
                <thead className="text-black/60">
                  <tr className="border-b border-black/10">
                    <th className="py-3 pr-4 font-semibold">Employee</th>
                    <th className="py-3 pr-4 font-semibold">Location</th>
                    <th className="py-3 pr-4 font-semibold">Shift</th>
                    <th className="py-3 pr-4 font-semibold">Check In</th>
                    <th className="py-3 pr-4 font-semibold">Check Out</th>
                    <th className="py-3 pr-4 font-semibold">Status</th>
                    <th className="py-3 pr-4 font-semibold text-right">Day Deductions</th>
                    <th className="py-3 pr-4 font-semibold text-right">Month Total</th>
                    <th className="py-3 pr-0 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-sm font-semibold text-black/55">
                        {loading ? "Loading employees…" : "No employees match your filters."}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const waivedLabel = attendanceWaivedBadgeLabel(row);
                      return (
                        <tr key={row.employee_id} className="border-b border-black/5 hover:bg-black/[0.02]">
                          <td className="py-3 pr-4 font-semibold">{row.full_name}</td>
                          <td className="py-3 pr-4 text-black/70">{row.work_location?.name ?? "—"}</td>
                          <td className="py-3 pr-4 text-black/70">{row.shift_label ?? "—"}</td>
                          <td className="py-3 pr-4 text-black/70">
                            {row.check_in_at ? formatLagosTime(row.check_in_at) : "—"}
                          </td>
                          <td className="py-3 pr-4 text-black/70">
                            {row.check_out_at ? formatLagosTime(row.check_out_at) : "—"}
                          </td>
                          <td className="py-3 pr-4">
                            <span
                              className={[
                                "rounded-full px-2 py-0.5 text-xs font-semibold",
                                attendanceMonitorStatusBadgeClass(row.status)
                              ].join(" ")}
                            >
                              {attendanceMonitorStatusLabel(row.status)}
                            </span>
                            {waivedLabel ? (
                              <span
                                className={[
                                  "ml-2 rounded-full px-2 py-0.5 text-xs font-semibold",
                                  attendanceWaivedBadgeClass()
                                ].join(" ")}
                                title={row.waivers?.length ? formatWaiverTooltip(row.waivers) : undefined}
                              >
                                {waivedLabel}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums font-semibold text-red-800">
                            {formatMoney(row.total_attendance_deductions_naira ?? 0)}
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums text-black/70">
                            <div className="text-xs">
                              Late {formatMoney(row.period_late_deduction_total_naira ?? 0)}
                            </div>
                            <div className="text-xs">
                              Early {formatMoney(row.period_early_sign_out_deduction_total_naira ?? 0)}
                            </div>
                            <div className="text-xs">
                              Abs {formatMoney(row.period_absence_deduction_total_naira ?? 0)}
                            </div>
                            <div className="font-bold text-red-800">
                              {formatMoney(row.period_total_attendance_deductions_naira ?? 0)}
                            </div>
                          </td>
                          <td className="py-3 pr-0 text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              {isAdmin ? (
                                <button
                                  type="button"
                                  className="text-sm font-semibold text-violet-700 hover:underline disabled:opacity-40"
                                  disabled={row.payroll_finalized || row.can_adjust_attendance === false}
                                  title={
                                    row.payroll_finalized
                                      ? "Payroll finalized — reopen month before adjusting"
                                      : undefined
                                  }
                                  onClick={() => setAdjustRow(row)}
                                >
                                  Adjust Attendance
                                </button>
                              ) : null}
                              <Link
                                to={`/attendance-records/${row.employee_id}`}
                                className="text-sm font-semibold text-blue-700 hover:underline"
                              >
                                View
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </ScrollTable>
            }
          />
        </div>
        {rowsTotal > PAGE_SIZE ? (
          <PaginationFooter page={page} pageSize={PAGE_SIZE} total={rowsTotal} onPageChange={setPage} />
        ) : null}
      </Card>

      {isAdmin ? (
        <>
          <AttendanceAdjustModal
            open={adjustRow != null}
            row={adjustRow}
            onClose={() => setAdjustRow(null)}
            onSaved={handleWaiverSaved}
            onError={(message) => toast.push("error", message)}
          />
          <AttendanceDailyWaiverModal
            open={dailyWaiverOpen}
            defaultDate={viewDate}
            onClose={() => setDailyWaiverOpen(false)}
            onSaved={() => {
              toast.push("success", "Daily attendance waiver applied.");
              refreshMonitor();
            }}
            onError={(message) => toast.push("error", message)}
          />
        </>
      ) : null}
    </div>
  );
}
