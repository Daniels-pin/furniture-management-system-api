import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { employeePaymentsApi, employeesApi } from "../../services/endpoints";
import { getErrorMessage } from "../../services/api";
import type { EmployeeListItem, PayrollPeriodsNav, PayrollSummary, SalaryPeriod } from "../../types/api";
import { formatMoney } from "../../utils/money";
import { getPayrollSummaryTotals, hasPayrollSummaryData } from "../../utils/payroll";

const COLLAPSE_MS = 280;
const SEARCH_DEBOUNCE_MS = 300;

function periodKey(year: number, month: number) {
  return `${year}-${month}`;
}

function MonthPaymentBadge({ period }: { period: SalaryPeriod }) {
  const paid = period.month_payment_status === "paid";
  return (
    <span
      className={
        paid
          ? "rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
          : "rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-950"
      }
    >
      {paid ? "Paid" : "Pending Payment"}
    </span>
  );
}

type MonthBundle = {
  rows: EmployeeListItem[];
  summary: PayrollSummary;
  loading: boolean;
  refreshing: boolean;
};

function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  return Boolean(el.closest('a,button,input,select,textarea,label,[role="button"],[role="checkbox"]'));
}

function MonthBodySkeleton() {
  return (
    <div className="space-y-4 py-1" aria-hidden>
      <div className="h-10 w-full max-w-md animate-pulse rounded-xl bg-black/[0.06]" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-black/[0.06]" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-xl bg-black/[0.04]" />
    </div>
  );
}

function PayrollFinancialSummary({ summary, refreshing }: { summary: PayrollSummary; refreshing?: boolean }) {
  const totals = getPayrollSummaryTotals(summary);
  return (
    <div className={["grid grid-cols-1 gap-3 sm:grid-cols-3", refreshing ? "opacity-80" : ""].join(" ")}>
      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">Total Salaries</div>
        <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(totals.totalSalaries)}</div>
        <p className="mt-1 text-xs text-black/45">
          {totals.hasBonuses ? "Base salaries plus bonuses (before deductions)" : "Combined base salaries before deductions"}
        </p>
      </Card>
      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">Total Deductions</div>
        <div className="mt-1 text-lg font-bold tabular-nums text-red-800">{formatMoney(totals.totalDeductions)}</div>
        <p className="mt-1 text-xs text-black/45">Lateness, absence, penalties &amp; manual deductions</p>
      </Card>
      <Card className="!border-black !bg-black !p-4 text-white">
        <div className="text-xs font-semibold text-white/70">Total Salaries Payable</div>
        <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(totals.totalPayable)}</div>
        <p className="mt-1 text-xs text-white/60">Total salaries minus total deductions</p>
      </Card>
    </div>
  );
}

type Props = {
  nav: PayrollPeriodsNav;
  onNavRefresh: () => Promise<void>;
  onToast: (kind: "success" | "error", message: string) => void;
};

export function PayrollMonthsPanel({ nav, onNavRefresh, onToast }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const prevPathRef = useRef(location.pathname);

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [mountedKeys, setMountedKeys] = useState<Set<string>>(() => new Set());
  const [bundles, setBundles] = useState<Record<string, MonthBundle>>({});
  const [monthlySearch, setMonthlySearch] = useState("");
  const [monthlySearchDebounced, setMonthlySearchDebounced] = useState("");
  const [monthlySelectedIds, setMonthlySelectedIds] = useState<number[]>([]);
  const [bulkNote, setBulkNote] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [markingKey, setMarkingKey] = useState<string | null>(null);
  const [employeeNavOpenKeys, setEmployeeNavOpenKeys] = useState<Set<string>>(() => new Set());
  const collapseTimersRef = useRef<Record<string, number>>({});

  const periods = nav.periods;

  function toggleEmployeeNav(key: string) {
    setEmployeeNavOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    const t = window.setTimeout(() => setMonthlySearchDebounced(monthlySearch), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [monthlySearch]);

  useEffect(() => {
    if (!nav.active_period) return;
    const key = periodKey(nav.active_period.year, nav.active_period.month);
    setExpandedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setMountedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    const hasYm = searchParams.get("year") && searchParams.get("month");
    if (!hasYm) {
      const sp = new URLSearchParams(searchParams);
      sp.set("year", String(nav.active_period.year));
      sp.set("month", String(nav.active_period.month));
      sp.set("tab", "monthly");
      setSearchParams(sp, { replace: true });
    }
  }, [nav.active_period, searchParams, setSearchParams]);

  useEffect(() => {
    return () => {
      for (const id of Object.values(collapseTimersRef.current)) {
        window.clearTimeout(id);
      }
    };
  }, []);

  const loadMonth = useCallback(
    async (year: number, month: number, search: string, options?: { background?: boolean }) => {
      const key = periodKey(year, month);
      const background = options?.background ?? false;
      setBundles((prev) => {
        const existing = prev[key];
        const hasCache = hasPayrollSummaryData(existing?.summary);
        return {
          ...prev,
          [key]: {
            rows: existing?.rows ?? [],
            summary: existing?.summary ?? ({} as PayrollSummary),
            loading: !background && !hasCache,
            refreshing: background || (hasCache && !background)
          }
        };
      });
      try {
        const params = { period_year: year, period_month: month };
        const [listData, sum] = await Promise.all([
          employeesApi.list({ ...params, search: search.trim() || undefined }),
          employeesApi.payrollSummary(params)
        ]);
        setBundles((prev) => ({
          ...prev,
          [key]: { rows: listData, summary: sum, loading: false, refreshing: false }
        }));
      } catch (e) {
        onToast("error", getErrorMessage(e));
        setBundles((prev) => ({
          ...prev,
          [key]: {
            rows: prev[key]?.rows ?? [],
            summary: prev[key]?.summary ?? ({} as PayrollSummary),
            loading: false,
            refreshing: false
          }
        }));
      }
    },
    [onToast]
  );

  const reloadExpandedMonths = useCallback(
    (search: string, background = true) => {
      for (const key of expandedKeys) {
        const [ys, ms] = key.split("-");
        const y = Number(ys);
        const m = Number(ms);
        if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
        void loadMonth(y, m, search, { background });
      }
    },
    [expandedKeys, loadMonth]
  );

  useEffect(() => {
    for (const key of expandedKeys) {
      const [ys, ms] = key.split("-");
      const y = Number(ys);
      const m = Number(ms);
      if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
      void loadMonth(y, m, monthlySearchDebounced);
    }
  }, [expandedKeys, monthlySearchDebounced, loadMonth]);

  useEffect(() => {
    function onFocus() {
      if (expandedKeys.size === 0) return;
      reloadExpandedMonths(monthlySearchDebounced, true);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [expandedKeys, monthlySearchDebounced, reloadExpandedMonths]);

  useEffect(() => {
    const prev = prevPathRef.current;
    const cameFromDetail = /\/employees\/\d+\/detail/.test(prev);
    const onList =
      location.pathname === "/employees" || (location.pathname.startsWith("/employees") && location.search.includes("tab=monthly"));
    if (cameFromDetail && onList && expandedKeys.size > 0) {
      reloadExpandedMonths(monthlySearchDebounced, true);
    }
    prevPathRef.current = location.pathname;
  }, [location.pathname, location.search, expandedKeys, monthlySearchDebounced, reloadExpandedMonths]);

  function toggleMonth(period: SalaryPeriod) {
    const key = periodKey(period.year, period.month);

    if (expandedKeys.has(key)) {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setEmployeeNavOpenKeys((navPrev) => {
        if (!navPrev.has(key)) return navPrev;
        const navNext = new Set(navPrev);
        navNext.delete(key);
        return navNext;
      });
      const existingTimer = collapseTimersRef.current[key];
      if (existingTimer) window.clearTimeout(existingTimer);
      collapseTimersRef.current[key] = window.setTimeout(() => {
        setMountedKeys((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        delete collapseTimersRef.current[key];
      }, COLLAPSE_MS);
    } else {
      const existingTimer = collapseTimersRef.current[key];
      if (existingTimer) {
        window.clearTimeout(existingTimer);
        delete collapseTimersRef.current[key];
      }
      setMountedKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    }

    const sp = new URLSearchParams(searchParams);
    sp.set("year", String(period.year));
    sp.set("month", String(period.month));
    sp.set("tab", "monthly");
    setSearchParams(sp, { replace: true });
  }

  async function handleMarkMonthPaid(period: SalaryPeriod) {
    const key = periodKey(period.year, period.month);
    setMarkingKey(key);
    try {
      await employeesApi.markMonthPaid({ period_year: period.year, period_month: period.month });
      onToast("success", `${period.label} marked paid.`);
      await onNavRefresh();
      await loadMonth(period.year, period.month, monthlySearchDebounced);
    } catch (e) {
      onToast("error", getErrorMessage(e));
    } finally {
      setMarkingKey(null);
    }
  }

  const activeKey = nav.active_period ? periodKey(nav.active_period.year, nav.active_period.month) : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm text-black/70">
        Payroll months advance automatically on the 1st of each calendar month. Historical months stay archived with
        attendance and payment records intact.
      </div>

      <label className="flex flex-col text-xs font-semibold text-black/60 sm:max-w-md">
        Search employees (expanded months)
        <input
          className="mt-1 rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
          value={monthlySearch}
          onChange={(e) => setMonthlySearch(e.target.value)}
          placeholder="Name…"
        />
      </label>

      {periods.length === 0 ? (
        <Card>
          <div className="text-sm text-black/70">
            Payroll months will appear after you add your first monthly employee. Only months with real payroll activity are
            tracked — empty calendar months are not created.
          </div>
        </Card>
      ) : null}

      <div className="space-y-3">
        {periods.map((period) => {
          const key = periodKey(period.year, period.month);
          const expanded = expandedKeys.has(key);
          const mounted = mountedKeys.has(key);
          const bundle = bundles[key];
          const isActive = period.is_active;
          const hasSummary = hasPayrollSummaryData(bundle?.summary);
          const showInitialLoad = mounted && (!bundle || (bundle.loading && !hasSummary));

          return (
            <Card key={key} className="!p-0 overflow-hidden">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-black/[0.02] transition-colors"
                onClick={() => toggleMonth(period)}
                aria-expanded={expanded}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-base font-bold tracking-tight">{period.label}</span>
                  {isActive ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                      Active
                    </span>
                  ) : null}
                  <MonthPaymentBadge period={period} />
                  {period.total_employee_count > 0 ? (
                    <span className="text-xs font-semibold text-black/50">
                      {period.paid_employee_count}/{period.total_employee_count} paid
                    </span>
                  ) : null}
                </div>
                <span
                  className={[
                    "shrink-0 text-black/40 transition-transform duration-300 ease-out",
                    expanded ? "rotate-0" : "-rotate-90"
                  ].join(" ")}
                  aria-hidden
                >
                  ▾
                </span>
              </button>

              {mounted ? (
                <div
                  className={[
                    "grid transition-[grid-template-rows] ease-out",
                    expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  ].join(" ")}
                  style={{ transitionDuration: `${COLLAPSE_MS}ms` }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="border-t border-black/10 px-4 pb-4 pt-3 space-y-4">
                      {!isActive ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                          Archived month — view only. Open the active month to edit payroll.
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-2">
                        {period.month_payment_status !== "paid" ? (
                          <Button
                            variant="secondary"
                            isLoading={markingKey === key}
                            onClick={() => void handleMarkMonthPaid(period)}
                          >
                            Mark Month Paid
                          </Button>
                        ) : null}
                        <Button
                          variant="secondary"
                          isLoading={exportingKey === key}
                          disabled={!bundle || bundle.loading}
                          onClick={async () => {
                            setExportingKey(key);
                            try {
                              await employeesApi.exportCsv({
                                period_year: period.year,
                                period_month: period.month
                              });
                              onToast("success", "Export downloaded.");
                            } catch (e) {
                              onToast("error", getErrorMessage(e));
                            } finally {
                              setExportingKey(null);
                            }
                          }}
                        >
                          Download CSV
                        </Button>
                        {isActive ? (
                          <>
                            <Button
                              variant="secondary"
                              isLoading={bulkSending}
                              disabled={monthlySelectedIds.length === 0 || activeKey !== key}
                              onClick={() => {
                                if (!bundle) return;
                                setBulkSending(true);
                                void employeePaymentsApi
                                  .bulkSend({
                                    items: monthlySelectedIds.map((id) => {
                                      const r = bundle.rows.find((x) => x.id === id);
                                      return {
                                        employee_kind: "monthly" as const,
                                        employee_id: id,
                                        period_year: period.year,
                                        period_month: period.month,
                                        amount: r?.salary?.final_payable ?? 0,
                                        note: bulkNote.trim() || null
                                      };
                                    })
                                  })
                                  .then((res) => onToast("success", `Sent ${res.created} payment(s) to Finance.`))
                                  .catch((e) => onToast("error", getErrorMessage(e)))
                                  .finally(() => setBulkSending(false));
                              }}
                            >
                              Bulk Send to Finance
                            </Button>
                            <Link
                              to={`/employees/new?year=${period.year}&month=${period.month}`}
                              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white"
                            >
                              Add employee
                            </Link>
                          </>
                        ) : null}
                        {bundle?.refreshing ? (
                          <span className="text-xs font-semibold text-black/45">Updating totals…</span>
                        ) : null}
                      </div>

                      {showInitialLoad ? (
                        <MonthBodySkeleton />
                      ) : hasSummary ? (
                        <>
                          <PayrollFinancialSummary summary={bundle!.summary} refreshing={bundle?.refreshing} />

                          <div className="grid grid-cols-1 gap-3 sm:max-w-sm">
                            <Card
                              className={[
                                "!p-0 overflow-hidden transition-shadow",
                                employeeNavOpenKeys.has(key) ? "ring-2 ring-black/15" : ""
                              ].join(" ")}
                            >
                              <button
                                type="button"
                                className="flex w-full items-start justify-between gap-2 p-4 text-left hover:bg-black/[0.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                                onClick={() => toggleEmployeeNav(key)}
                                aria-expanded={employeeNavOpenKeys.has(key)}
                                aria-controls={`employee-nav-${key}`}
                              >
                                <div>
                                  <div className="text-xs font-semibold text-black/55">Employees</div>
                                  <div className="mt-1 text-lg font-bold">{bundle!.summary.employee_count}</div>
                                  <div className="mt-1 text-xs font-semibold text-black/45">
                                    {employeeNavOpenKeys.has(key) ? "Hide list" : "View employees"}
                                  </div>
                                </div>
                                <span className="shrink-0 pt-1 text-black/35" aria-hidden>
                                  {employeeNavOpenKeys.has(key) ? "▾" : "▸"}
                                </span>
                              </button>
                              {employeeNavOpenKeys.has(key) ? (
                                <div
                                  id={`employee-nav-${key}`}
                                  className="border-t border-black/10 bg-black/[0.02] px-2 py-2 max-h-64 overflow-y-auto"
                                >
                                  {!bundle || bundle.rows.length === 0 ? (
                                    <p className="px-2 py-2 text-sm text-black/60">No employees for this month.</p>
                                  ) : (
                                    <ul className="space-y-0.5">
                                      {[...bundle.rows]
                                        .sort((a, b) => a.full_name.localeCompare(b.full_name))
                                        .map((r) => (
                                          <li key={r.id}>
                                            <Link
                                              to={`/employees/${r.id}/detail?year=${period.year}&month=${period.month}`}
                                              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-black hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                                            >
                                              <span className="min-w-0 truncate">{r.full_name}</span>
                                              <span
                                                className={
                                                  r.payment.status === "paid"
                                                    ? "shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-900"
                                                    : "shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900"
                                                }
                                              >
                                                {r.payment.status === "paid" ? "Paid" : "Unpaid"}
                                              </span>
                                            </Link>
                                          </li>
                                        ))}
                                    </ul>
                                  )}
                                  {monthlySearch.trim() &&
                                  bundle &&
                                  bundle.rows.length > 0 &&
                                  bundle.rows.length < bundle.summary.employee_count ? (
                                    <p className="px-3 pb-1 text-xs font-semibold text-black/45">
                                      Showing {bundle.rows.length} of {bundle.summary.employee_count} — clear search to see
                                      all.
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                            </Card>
                          </div>

                          {bundle && bundle.rows.length === 0 ? (
                            <div className="text-sm text-black/60">No employees for this month.</div>
                          ) : bundle ? (
                            <div className="hidden md:block overflow-x-auto">
                              <table className="w-full min-w-[720px] text-left text-sm">
                                <thead className="text-black/60">
                                  <tr className="border-b border-black/10">
                                    {isActive ? (
                                      <th className="py-3 pr-4">
                                        <input
                                          type="checkbox"
                                          checked={
                                            activeKey === key &&
                                            monthlySelectedIds.length > 0 &&
                                            monthlySelectedIds.length === bundle.rows.length
                                          }
                                          onChange={(e) => {
                                            if (e.target.checked) setMonthlySelectedIds(bundle.rows.map((r) => r.id));
                                            else setMonthlySelectedIds([]);
                                          }}
                                        />
                                      </th>
                                    ) : (
                                      <th className="py-3 pr-4" />
                                    )}
                                    <th className="py-3 pr-4 font-semibold">Name</th>
                                    <th className="py-3 pr-0 font-semibold">Payment</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {bundle.rows.map((r) => (
                                    <tr
                                      key={r.id}
                                      className="border-b border-black/5 cursor-pointer hover:bg-black/[0.02]"
                                      onClick={(e) => {
                                        if (isInteractiveTarget(e.target)) return;
                                        navigate(`/employees/${r.id}/detail?year=${period.year}&month=${period.month}`);
                                      }}
                                    >
                                      {isActive ? (
                                        <td className="py-3 pr-4">
                                          <input
                                            type="checkbox"
                                            checked={activeKey === key && monthlySelectedIds.includes(r.id)}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                              setMonthlySelectedIds((prev) =>
                                                e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)
                                              );
                                            }}
                                          />
                                        </td>
                                      ) : (
                                        <td className="py-3 pr-4" />
                                      )}
                                      <td className="py-3 pr-4 font-semibold">{r.full_name}</td>
                                      <td className="py-3 pr-0">
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
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="text-sm text-black/60">Unable to load payroll data.</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
