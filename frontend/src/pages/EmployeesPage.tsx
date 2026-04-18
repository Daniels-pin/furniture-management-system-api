import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { employeesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import type { EmployeeListItem, PayrollPeriodsNav, PayrollSummary } from "../types/api";
import { formatMoney } from "../utils/money";

export function EmployeesPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));

  const [nav, setNav] = useState<PayrollPeriodsNav | null>(null);
  const [rows, setRows] = useState<EmployeeListItem[]>([]);
  const [summary, setSummary] = useState<PayrollSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [startingMonth, setStartingMonth] = useState(false);

  const periodParams = useMemo(() => {
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return null;
    }
    return { period_year: year, period_month: month };
  }, [year, month]);

  /** Load month list */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const n = await employeesApi.payrollPeriodsNav();
        if (!alive) return;
        setNav(n);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  /** Default URL to active payroll month when missing */
  useEffect(() => {
    if (!nav?.active_period) return;
    const hasYm = searchParams.get("year") && searchParams.get("month");
    if (!hasYm) {
      setSearchParams(
        { year: String(nav.active_period.year), month: String(nav.active_period.month) },
        { replace: true }
      );
    }
  }, [nav, searchParams, setSearchParams]);

  /** If URL points to a month not in the archive (e.g. stale bookmark), snap to active */
  useEffect(() => {
    if (!nav?.periods.length || !nav.active_period) return;
    if (!Number.isFinite(year) || !Number.isFinite(month)) return;
    const valid = nav.periods.some((p) => p.year === year && p.month === month);
    if (!valid) {
      setSearchParams(
        { year: String(nav.active_period.year), month: String(nav.active_period.month) },
        { replace: true }
      );
    }
  }, [nav, year, month, setSearchParams]);

  useEffect(() => {
    let alive = true;
    if (!periodParams) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const [listData, sum] = await Promise.all([
          employeesApi.list(periodParams),
          employeesApi.payrollSummary(periodParams)
        ]);
        if (alive) {
          setRows(listData);
          setSummary(sum);
        }
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast, periodParams]);

  function setPeriod(nextYear: number, nextMonth: number) {
    setSearchParams({ year: String(nextYear), month: String(nextMonth) });
  }

  const currentKey = Number.isFinite(year) && Number.isFinite(month) ? `${year}-${month}` : "";
  const selectedPeriod = nav?.periods.find((p) => p.year === year && p.month === month);
  const isViewingActive = selectedPeriod?.is_active === true;

  async function onStartNextMonth() {
    if (
      !window.confirm(
        "Start the next payroll month?\n\nThe current month will be archived (still viewable here). Lateness, penalties, and bonuses start fresh in the new month; base salaries are unchanged."
      )
    ) {
      return;
    }
    setStartingMonth(true);
    try {
      const n = await employeesApi.startNextPayrollMonth();
      setNav(n);
      if (n.active_period) {
        setSearchParams({ year: String(n.active_period.year), month: String(n.active_period.month) });
      }
      toast.push("success", `Active payroll month is now ${n.active_period?.label ?? "updated"}.`);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setStartingMonth(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Employees</div>
          <div className="mt-1 text-sm text-black/60">
            Choose a payroll month from your archive. Only the active month can be edited; older months are read-only.
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col text-xs font-semibold text-black/60 sm:min-w-[220px]">
            Payroll month
            <select
              className="mt-1 rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              disabled={!nav?.periods.length}
              value={nav?.periods.some((p) => p.year === year && p.month === month) ? currentKey : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const [ys, ms] = v.split("-");
                setPeriod(Number(ys), Number(ms));
              }}
            >
              {!nav?.periods.length ? (
                <option value="">No months yet — start a month below</option>
              ) : (
                nav.periods.map((p) => (
                  <option key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
                    {p.label}
                    {p.is_active ? " (active)" : ""}
                  </option>
                ))
              )}
            </select>
          </label>
          <Button
            variant="secondary"
            isLoading={startingMonth}
            disabled={nav === null}
            onClick={() => void onStartNextMonth()}
            title="Creates the next calendar month and makes it the active payroll period"
          >
            Start new month
          </Button>
          <Button
            variant="secondary"
            isLoading={exporting}
            disabled={!periodParams}
            onClick={async () => {
              if (!periodParams) return;
              setExporting(true);
              try {
                await employeesApi.exportCsv(periodParams);
                toast.push("success", "Export downloaded.");
              } catch (e) {
                toast.push("error", getErrorMessage(e));
              } finally {
                setExporting(false);
              }
            }}
          >
            Download CSV
          </Button>
          <Link
            to={periodParams ? `/employees/new?year=${periodParams.period_year}&month=${periodParams.period_month}` : "/employees/new"}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black/90 active:translate-y-[1px]"
          >
            Add employee
          </Link>
        </div>
      </div>

      {selectedPeriod && !isViewingActive ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span className="font-semibold">Viewing archived month.</span> Payroll lines and payments cannot be changed here. Open{" "}
          <span className="font-semibold">{nav?.active_period?.label ?? "the active month"}</span> to edit.
        </div>
      ) : null}

      {summary ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Period</div>
            <div className="mt-1 text-sm font-bold">{summary.period.label}</div>
            <div className="mt-1 text-xs text-black/50">{summary.employee_count} employees</div>
            {summary.period.is_active ? (
              <div className="mt-2 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                Active payroll
              </div>
            ) : (
              <div className="mt-2 inline-block rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/70">
                Archived
              </div>
            )}
          </Card>
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Total base salaries</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary.total_base_salary)}</div>
          </Card>
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Total deductions</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-red-800">{formatMoney(summary.total_deductions)}</div>
          </Card>
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Total bonuses</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-emerald-800">{formatMoney(summary.total_bonuses)}</div>
          </Card>
          <Card className="!border-black !bg-black !p-4 text-white">
            <div className="text-xs font-semibold text-white/70">Net payroll</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary.net_payroll)}</div>
          </Card>
        </div>
      ) : null}

      <Card>
        {loading || !periodParams ? (
          <div className="text-sm text-black/60">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-black/60">No employees yet. Add one to get started.</div>
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="text-black/60">
                <tr className="border-b border-black/10">
                  <th className="py-3 pr-4 font-semibold">Name</th>
                  <th className="py-3 pr-4 font-semibold">Phone</th>
                  <th className="py-3 pr-4 font-semibold">Account</th>
                  <th className="py-3 pr-4 text-right font-semibold">Base</th>
                  <th className="py-3 pr-4 text-right font-semibold">Final payable</th>
                  <th className="py-3 pr-4 font-semibold">Payment</th>
                  <th className="py-3 pr-0 text-right font-semibold"> </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-black/5">
                    <td className="py-3 pr-4 font-semibold">{r.full_name}</td>
                    <td className="py-3 pr-4">{r.phone ?? "—"}</td>
                    <td className="py-3 pr-4 font-mono text-xs">{r.account_number ?? "—"}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{formatMoney(r.base_salary)}</td>
                    <td className="py-3 pr-4 text-right font-semibold tabular-nums">
                      {formatMoney(r.salary.final_payable)}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={
                          r.payment.status === "paid"
                            ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900"
                            : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
                        }
                      >
                        {r.payment.status === "paid" ? "Paid" : "Unpaid"}
                      </span>
                    </td>
                    <td className="py-3 pr-0 text-right">
                      <Link
                        className="text-sm font-semibold text-black underline decoration-black/30 underline-offset-2"
                        to={`/employees/${r.id}?year=${year}&month=${month}`}
                      >
                        Manage
                      </Link>
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
