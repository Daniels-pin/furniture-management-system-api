import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { contractJobsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { formatMoney } from "../utils/money";
import type { AdminJobsSummary, ContractJob } from "../types/api";
import { usePageHeader } from "../components/layout/pageHeader";

function JobStatusBadge({ status }: { status: ContractJob["status"] }) {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset";
  const cls =
    status === "pending"
      ? "bg-black/5 text-black/70 ring-black/10"
      : status === "in_progress"
        ? "bg-yellow-100 text-yellow-900 ring-yellow-200"
        : status === "completed"
          ? "bg-green-100 text-green-900 ring-green-200"
          : status === "cancelled"
            ? "bg-red-100 text-red-900 ring-red-200"
            : "bg-black/5 text-black/70 ring-black/10";
  const label =
    status === "in_progress"
      ? "In Progress"
      : status === "cancelled"
        ? "Cancelled"
        : status[0].toUpperCase() + status.slice(1);
  return <span className={[base, cls].join(" ")}>{label}</span>;
}

function PaidFlagBadge({ paid }: { paid: boolean }) {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset";
  const cls = paid ? "bg-emerald-100 text-emerald-900 ring-emerald-200" : "bg-black/5 text-black/70 ring-black/10";
  return <span className={[base, cls].join(" ")}>{paid ? "Paid" : "Not paid"}</span>;
}

export function AdminJobsPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<ContractJob[]>([]);
  const [summary, setSummary] = useState<AdminJobsSummary | null>(null);

  usePageHeader({
    title: "Jobs",
    subtitle: "All contract jobs across all employees."
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [s, j] = await Promise.all([contractJobsApi.summaryAdmin(), contractJobsApi.listAdmin()]);
        if (!alive) return;
        setSummary(s);
        setJobs(Array.isArray(j) ? j : []);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
        if (!alive) return;
        setSummary(null);
        setJobs([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  const rows = useMemo(() => jobs, [jobs]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Jobs summary</div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Total jobs</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{summary?.jobs.total ?? 0}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Completed</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{summary?.jobs.completed ?? 0}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Pending</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{summary?.jobs.pending ?? 0}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">In progress</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{summary?.jobs.in_progress ?? 0}</div>
            </div>
          </div>
        </Card>

        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Contract employees financial summary</div>
          <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Total paid</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary?.financials.total_paid ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Total owed</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary?.financials.total_owed ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Current balance</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary?.financials.balance ?? 0)}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-black/50">Balance \(=\) owed − paid. Positive means the company owes contract employees.</div>
        </Card>
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-black/10 px-4 py-3">
          <div className="text-sm font-semibold">All jobs</div>
          <div className="mt-0.5 text-xs text-black/55">Click a row to view full job details.</div>
        </div>

        {loading ? (
          <div className="px-4 py-4 text-sm text-black/60">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-4 text-sm text-black/60">No jobs found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-black/[0.02] text-xs font-semibold text-black/60">
                <tr>
                  <th className="px-4 py-3">Job</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {rows.map((j) => (
                  <tr
                    key={j.id}
                    className="cursor-pointer hover:bg-black/[0.02]"
                    onClick={() => nav(`/admin/jobs/${j.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") nav(`/admin/jobs/${j.id}`);
                    }}
                  >
                    <td className="px-4 py-3 font-semibold">#{j.id}</td>
                    <td className="px-4 py-3 text-black/70">
                      <div className="line-clamp-2">{(j.description || "").trim() || "—"}</div>
                    </td>
                    <td className="px-4 py-3">{j.contract_employee_name || `Employee #${j.contract_employee_id}`}</td>
                    <td className="px-4 py-3">
                      <JobStatusBadge status={j.status} />
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums">
                      {j.final_price != null ? formatMoney(j.final_price) : j.price_offer != null ? formatMoney(j.price_offer) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <PaidFlagBadge paid={Boolean(j.paid_flag)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

