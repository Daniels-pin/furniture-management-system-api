import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { companyLocationsApi, employeesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { usePageHeader } from "../components/layout/pageHeader";
import type {
  AttendanceMonitorFilterStatus,
  AttendanceMonitorResponse,
  CompanyLocation
} from "../types/api";
import {
  attendanceMonitorStatusBadgeClass,
  attendanceMonitorStatusLabel,
  attendanceTodayKey
} from "../utils/attendance";
import { formatLagosTime } from "../utils/datetime";

const POLL_MS = 15_000;

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

export function AttendanceRecordsPage() {
  const toast = useToast();
  const todayKey = useMemo(() => attendanceTodayKey(), []);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | AttendanceMonitorFilterStatus>("");
  const [locationFilter, setLocationFilter] = useState<string>("");
  const [locations, setLocations] = useState<CompanyLocation[]>([]);
  const [monitor, setMonitor] = useState<AttendanceMonitorResponse | null>(null);
  const [loading, setLoading] = useState(true);

  usePageHeader({
    title: "Attendance Records",
    subtitle: "Real-time attendance overview and employee history for assigned staff."
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchDebounced(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await companyLocationsApi.list();
        if (!alive) return;
        setLocations(rows);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    async function load() {
      try {
        const data = await employeesApi.attendanceMonitor({
          date: todayKey,
          search: searchDebounced || undefined,
          status: statusFilter || undefined,
          location_id: locationFilter ? Number(locationFilter) : undefined
        });
        if (!alive) return;
        setMonitor(data);
      } catch (e) {
        if (alive) toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    }

    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };

    void load();
    timer = window.setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [todayKey, searchDebounced, statusFilter, locationFilter, toast]);

  const summary = monitor?.summary;
  const rows = monitor?.rows ?? [];

  const locationOptions = useMemo(
    () => [
      { value: "", label: "All locations" },
      ...locations.map((loc) => ({ value: String(loc.id), label: loc.name }))
    ],
    [locations]
  );

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Today&apos;s Attendance</h2>
            <p className="mt-1 text-sm text-black/60">
              {summary?.attendance_date ?? todayKey} · updates automatically
            </p>
          </div>
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

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="text-black/60">
              <tr className="border-b border-black/10">
                <th className="py-3 pr-4 font-semibold">Employee</th>
                <th className="py-3 pr-4 font-semibold">Location</th>
                <th className="py-3 pr-4 font-semibold">Shift</th>
                <th className="py-3 pr-4 font-semibold">Check In</th>
                <th className="py-3 pr-4 font-semibold">Check Out</th>
                <th className="py-3 pr-4 font-semibold">Status</th>
                <th className="py-3 pr-0 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm font-semibold text-black/55">
                    {loading ? "Loading employees…" : "No employees match your filters."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
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
                    </td>
                    <td className="py-3 pr-0 text-right">
                      <Link
                        to={`/attendance-records/${row.employee_id}`}
                        className="text-sm font-semibold text-blue-700 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
