import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { PaginationFooter } from "../components/ui/Pagination";
import { fieldVisitsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { usePageHeader } from "../components/layout/pageHeader";
import type { FieldVisitEmployeeOption, FieldVisitListItem, FieldVisitOptions, FieldVisitSummary } from "../types/api";
import { formatLagosDateTime } from "../utils/datetime";
import { formatMoney } from "../utils/money";
import {
  DataListCard,
  DataListMetric,
  PageToolbar,
  ResponsiveDataList,
  ScrollTable
} from "../components/ui/responsive";

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function FieldVisitsPage() {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const isAdmin = auth.isAdmin;

  const pageSize = isAdmin ? 20 : 15;
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FieldVisitListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<FieldVisitSummary | null>(null);
  const [options, setOptions] = useState<FieldVisitOptions | null>(null);
  const [employees, setEmployees] = useState<FieldVisitEmployeeOption[]>([]);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [employeeId, setEmployeeId] = useState("");
  const [projectType, setProjectType] = useState("");
  const [furnitureNeeded, setFurnitureNeeded] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [location, setLocation] = useState("");
  const [visitOutcome, setVisitOutcome] = useState("");
  const [exporting, setExporting] = useState(false);

  usePageHeader({
    title: "Field Visits",
    subtitle: isAdmin
      ? "Review all showroom site visits, filter results, and export records."
      : "Record and review your construction site field visits."
  });

  const filterParams = useMemo(
    () => ({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      ...(isAdmin && employeeId ? { employee_id: Number(employeeId) } : {}),
      ...(projectType ? { project_type: projectType } : {}),
      ...(furnitureNeeded ? { furniture_needed: furnitureNeeded } : {}),
      ...(dateFrom ? { date_from: dateFrom } : {}),
      ...(dateTo ? { date_to: dateTo } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(visitOutcome ? { visit_outcome: visitOutcome } : {})
    }),
    [page, pageSize, debouncedSearch, isAdmin, employeeId, projectType, furnitureNeeded, dateFrom, dateTo, location, visitOutcome]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const requests: Promise<unknown>[] = [fieldVisitsApi.page(filterParams)];
      if (isAdmin) requests.push(fieldVisitsApi.summary());
      const results = await Promise.all(requests);
      const pageData = results[0] as Awaited<ReturnType<typeof fieldVisitsApi.page>>;
      setRows(pageData.items);
      setTotal(pageData.total);
      if (isAdmin && results[1]) setSummary(results[1] as FieldVisitSummary);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [filterParams, isAdmin, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, employeeId, projectType, furnitureNeeded, dateFrom, dateTo, location, visitOutcome]);

  useEffect(() => {
    let alive = true;
    void fieldVisitsApi
      .options()
      .then((opts) => {
        if (alive) setOptions(opts);
      })
      .catch(() => {});
    if (isAdmin) {
      void fieldVisitsApi
        .employees()
        .then((xs) => {
          if (alive) setEmployees(xs);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  function isInteractiveTarget(target: EventTarget | null): boolean {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    return Boolean(el.closest('a,button,input,select,textarea,label,[role="button"]'));
  }

  async function handleExport() {
    setExporting(true);
    try {
      await fieldVisitsApi.exportCsv(filterParams);
      toast.push("success", "Export downloaded.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {isAdmin && summary ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Total Visits</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{summary.total_visits}</div>
          </Card>
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Visits This Week</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{summary.visits_this_week}</div>
          </Card>
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Visits This Month</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{summary.visits_this_month}</div>
          </Card>
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Estimated Pipeline Value</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary.estimated_pipeline_value)}</div>
          </Card>
          <Card className="!p-4">
            <div className="text-xs font-semibold text-black/55">Active Showroom Employees</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{summary.active_showroom_employees}</div>
          </Card>
        </div>
      ) : null}

      <Card>
        <PageToolbar
          search={
            <Input
              label="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="FV number, project, employee, location, phone…"
            />
          }
          actions={
            <>
              <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
                Refresh
              </Button>
              {isAdmin ? (
                <Button variant="secondary" isLoading={exporting} onClick={() => void handleExport()}>
                  Export CSV
                </Button>
              ) : null}
              <Button onClick={() => navigate("/field-visits/new")}>New Field Visit</Button>
            </>
          }
        />

        {isAdmin ? (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-black/60">Employee</label>
              <select
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">All employees</option>
                {employees.map((e) => (
                  <option key={e.id} value={String(e.id)}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-black/60">Project Type</label>
              <select
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm"
                value={projectType}
                onChange={(e) => setProjectType(e.target.value)}
              >
                <option value="">All types</option>
                {(options?.project_types ?? []).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-black/60">Furniture Needed</label>
              <select
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm"
                value={furnitureNeeded}
                onChange={(e) => setFurnitureNeeded(e.target.value)}
              >
                <option value="">All categories</option>
                {(options?.furniture_categories ?? []).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-black/60">Visit Outcome</label>
              <select
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm"
                value={visitOutcome}
                onChange={(e) => setVisitOutcome(e.target.value)}
              >
                <option value="">All outcomes</option>
                {(options?.visit_outcomes ?? []).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <Input label="Date from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <Input label="Date to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <div className="md:col-span-2">
              <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Filter by location" />
            </div>
          </div>
        ) : null}

        <div className="mt-5">
          <ResponsiveDataList
            mobile={
              loading ? (
                <div className="text-sm text-black/60">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="text-sm text-black/60">No field visits found.</div>
              ) : (
                rows.map((row) => (
                  <DataListCard
                    key={row.id}
                    title={row.visit_number}
                    subtitle={row.project_name}
                    badge={
                      <span className="rounded-full bg-black/[0.06] px-2.5 py-1 text-xs font-semibold">
                        {row.visit_outcome}
                      </span>
                    }
                    onClick={() => navigate(`/field-visits/${row.id}`)}
                    metrics={
                      <>
                        <DataListMetric
                          label="Date"
                          value={formatLagosDateTime(row.visit_at, { month: "short", day: "numeric", year: "numeric" })}
                        />
                        <DataListMetric label="Location" value={row.project_location} />
                        {isAdmin ? <DataListMetric label="Employee" value={row.employee_name || "—"} /> : null}
                        {isAdmin ? <DataListMetric label="Type" value={row.project_type} /> : null}
                        <DataListMetric
                          label="Value"
                          value={
                            row.estimated_opportunity_value != null
                              ? formatMoney(row.estimated_opportunity_value)
                              : "—"
                          }
                        />
                        {isAdmin ? <DataListMetric label="Photos" value={row.photo_count} /> : null}
                      </>
                    }
                  >
                    {isAdmin && row.furniture_needed.length ? (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {row.furniture_needed.slice(0, 3).map((f) => (
                          <span key={f} className="rounded-full bg-black/[0.06] px-2 py-0.5 text-xs font-medium">
                            {f}
                          </span>
                        ))}
                        {row.furniture_needed.length > 3 ? (
                          <span className="text-xs text-black/50">+{row.furniture_needed.length - 3}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </DataListCard>
                ))
              )
            }
            desktop={
              <ScrollTable minWidth={isAdmin ? 1100 : 720}>
                <thead>
                  <tr className="border-b border-black/10 text-black/60">
                    <th className="py-3 pr-4 font-semibold">FV Number</th>
                    <th className="py-3 pr-4 font-semibold">Date</th>
                    {isAdmin ? <th className="py-3 pr-4 font-semibold">Employee</th> : null}
                    <th className="py-3 pr-4 font-semibold">Project Name</th>
                    <th className="py-3 pr-4 font-semibold">Location</th>
                    {isAdmin ? <th className="py-3 pr-4 font-semibold">Project Type</th> : null}
                    {isAdmin ? <th className="py-3 pr-4 font-semibold">Furniture Needed</th> : null}
                    <th className="py-3 pr-4 font-semibold">Opportunity Value</th>
                    <th className="py-3 pr-4 font-semibold">Visit Outcome</th>
                    {isAdmin ? <th className="py-3 pr-0 font-semibold">Photos</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={isAdmin ? 10 : 6} className="py-8 text-black/60">
                        Loading…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={isAdmin ? 10 : 6} className="py-8 text-black/60">
                        No field visits found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr
                        key={row.id}
                        className="cursor-pointer border-b border-black/5 hover:bg-black/[0.02]"
                        onClick={(e) => {
                          if (isInteractiveTarget(e.target)) return;
                          navigate(`/field-visits/${row.id}`);
                        }}
                      >
                        <td className="py-3 pr-4 font-semibold">{row.visit_number}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">
                          {formatLagosDateTime(row.visit_at, { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        {isAdmin ? <td className="py-3 pr-4">{row.employee_name || "—"}</td> : null}
                        <td className="py-3 pr-4">{row.project_name}</td>
                        <td className="py-3 pr-4">{row.project_location}</td>
                        {isAdmin ? <td className="py-3 pr-4">{row.project_type}</td> : null}
                        {isAdmin ? (
                          <td className="py-3 pr-4">
                            <div className="flex max-w-[220px] flex-wrap gap-1">
                              {row.furniture_needed.slice(0, 2).map((f) => (
                                <span key={f} className="rounded-full bg-black/[0.06] px-2 py-0.5 text-xs font-medium">
                                  {f}
                                </span>
                              ))}
                              {row.furniture_needed.length > 2 ? (
                                <span className="text-xs text-black/50">+{row.furniture_needed.length - 2}</span>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                        <td className="py-3 pr-4 tabular-nums">
                          {row.estimated_opportunity_value != null ? formatMoney(row.estimated_opportunity_value) : "—"}
                        </td>
                        <td className="py-3 pr-4">{row.visit_outcome}</td>
                        {isAdmin ? <td className="py-3 pr-0 tabular-nums">{row.photo_count}</td> : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </ScrollTable>
            }
          />
        </div>

        <PaginationFooter page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
      </Card>
    </div>
  );
}
