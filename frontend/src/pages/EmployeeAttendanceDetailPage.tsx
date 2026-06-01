import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { AttendanceMonthArchive } from "../components/employee/AttendanceMonthArchive";
import { AttendanceRulesSummary } from "../components/employee/AttendanceRulesSummary";
import { employeesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { usePageHeader } from "../components/layout/pageHeader";
import type { EmployeeAttendanceMonthSummary, EmployeeAttendanceOverview } from "../types/api";
import { buildAttendanceRulesSummary } from "../utils/attendanceRules";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-black/10 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-black/50">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

export function EmployeeAttendanceDetailPage() {
  const toast = useToast();
  const { employeeId } = useParams();
  const idNum = Number(employeeId);
  const [overview, setOverview] = useState<EmployeeAttendanceOverview | null>(null);
  const [months, setMonths] = useState<EmployeeAttendanceMonthSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const rulesModel = useMemo(
    () => buildAttendanceRulesSummary(overview?.work_location ?? null, null),
    [overview?.work_location]
  );

  usePageHeader({
    title: overview?.full_name ?? "Attendance Detail",
    subtitle: "Employee attendance history and monthly archives."
  });

  useEffect(() => {
    if (!Number.isFinite(idNum)) {
      setLoading(false);
      setOverview(null);
      return;
    }

    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [ov, monthRows] = await Promise.all([
          employeesApi.attendanceOverview(idNum),
          employeesApi.attendanceMonths(idNum)
        ]);
        if (!alive) return;
        setOverview(ov);
        setMonths(monthRows);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [idNum, toast]);

  if (!Number.isFinite(idNum)) {
    return (
      <Card>
        <p className="text-sm font-semibold text-black/70">Invalid employee.</p>
        <Link to="/attendance-records" className="mt-3 inline-block text-sm font-semibold text-blue-700 hover:underline">
          Back to Attendance Records
        </Link>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <p className="text-sm font-semibold text-black/55">Loading attendance detail…</p>
      </Card>
    );
  }

  if (!overview) {
    return (
      <Card>
        <p className="text-sm font-semibold text-black/70">Employee not found.</p>
        <Link to="/attendance-records" className="mt-3 inline-block text-sm font-semibold text-blue-700 hover:underline">
          Back to Attendance Records
        </Link>
      </Card>
    );
  }

  const stats = overview.stats;
  const statsLabel = new Date(stats.year, stats.month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });

  return (
    <div className="space-y-6">
      <div>
        <Link to="/attendance-records" className="text-sm font-semibold text-blue-700 hover:underline">
          ← Back to Attendance Records
        </Link>
      </div>

      <Card>
        <h2 className="text-lg font-bold tracking-tight">{overview.full_name}</h2>
        <p className="mt-1 text-sm text-black/60">
          Assigned location: {overview.work_location?.name ?? "Not assigned"}
        </p>

        <div className="mt-4">
          <h3 className="text-sm font-bold uppercase tracking-wide text-black/50">Current Attendance Rules</h3>
          <AttendanceRulesSummary model={rulesModel} className="mt-2" />
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-bold uppercase tracking-wide text-black/50">Attendance Statistics</h3>
        <p className="mt-1 text-xs font-semibold text-black/55">{statsLabel}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Present" value={stats.present} />
          <StatCard label="Late" value={stats.late} />
          <StatCard label="Early Sign-Out" value={stats.early_sign_out} />
          <StatCard label="Absent" value={stats.absent} />
          <StatCard label="Checked In Only" value={stats.checked_in_only} />
          <StatCard label="Incomplete Day" value={stats.incomplete_day} />
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-bold uppercase tracking-wide text-black/50">Attendance History</h3>
        <p className="mt-1 text-xs font-semibold text-black/55">
          Current month is expanded by default. Older months load when opened.
        </p>
        <div className="mt-4">
          <AttendanceMonthArchive employeeId={overview.employee_id} months={months} />
        </div>
      </Card>
    </div>
  );
}
