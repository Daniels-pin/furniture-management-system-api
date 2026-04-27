import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { contractEmployeesApi, employeePaymentsApi, employeesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import type {
  ContractEmployeeListItem,
  EmployeeListItem,
  EmployeeTransaction,
  PayrollPeriodsNav,
  PayrollSummary,
  PendingEmployeePayments
} from "../types/api";
import { formatMoney } from "../utils/money";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";
import { usePageHeader } from "../components/layout/pageHeader";

export function EmployeesPage() {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  const tab = (searchParams.get("tab") || (auth.role === "finance" ? "pending" : "monthly")) as
    | "monthly"
    | "contract"
    | "pending";
  const refreshToken = searchParams.get("r");

  const [nav, setNav] = useState<PayrollPeriodsNav | null>(null);
  const [rows, setRows] = useState<EmployeeListItem[]>([]);
  const [monthlySearch, setMonthlySearch] = useState("");
  const [monthlySelectedIds, setMonthlySelectedIds] = useState<number[]>([]);
  const [bulkNote, setBulkNote] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  const [summary, setSummary] = useState<PayrollSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [startingMonth, setStartingMonth] = useState(false);

  const [pending, setPending] = useState<PendingEmployeePayments | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingBusyId, setPendingBusyId] = useState<number | null>(null);
  const [pendingSearch, setPendingSearch] = useState("");
  const [pendingSort, setPendingSort] = useState<"oldest" | "newest" | "amount_desc" | "amount_asc">("oldest");
  const [pendingOverpaidOnly, setPendingOverpaidOnly] = useState(false);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [confirmMarkPaid, setConfirmMarkPaid] = useState<{ id: number; overpay?: boolean } | null>(null);
  const [confirmStartMonthOpen, setConfirmStartMonthOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<{ id: number; kind: "monthly" | "contract"; employeeId: number } | null>(
    null
  );
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);

  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);

  function isInteractiveTarget(target: EventTarget | null): boolean {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    return Boolean(el.closest('a,button,input,select,textarea,label,[role="button"],[role="checkbox"]'));
  }

  const [contractRows, setContractRows] = useState<ContractEmployeeListItem[]>([]);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractSearch, setContractSearch] = useState("");
  const [contractStatusFilter, setContractStatusFilter] = useState<"active" | "inactive">("active");
  const [contractOverpaidOnly, setContractOverpaidOnly] = useState(false);
  const [contractSelectedIds, setContractSelectedIds] = useState<number[]>([]);
  const [contractBulkAmt, setContractBulkAmt] = useState("");
  const [contractBulkNote, setContractBulkNote] = useState("");
  const [contractBulkSending, setContractBulkSending] = useState(false);

  usePageHeader({
    title: "Employees",
    subtitle:
      auth.role === "finance"
        ? "Review pending payments, upload receipts, and finalize payments."
        : auth.role === "factory"
          ? "Create employee records only. Payroll, payments, and employee lists are restricted."
        : "Monthly payroll and contract employees, with a controlled Admin → Finance workflow."
  });

  if (auth.role === "factory") {
    return (
      <div className="space-y-6">
        <Card>
          <div className="text-lg font-bold tracking-tight">Employees</div>
          <p className="mt-2 text-sm text-black/70">
            Factory can only create employee records. Viewing employee lists, payroll, and payments is restricted.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to="/contract-employees/new"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black/90 active:translate-y-[1px]"
            >
              Create Contract Employee
            </Link>
            <Link
              to="/employees/new"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-black/5"
            >
              Create Monthly Employee
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // Drawer removed: monthly employees use list → click → detail page pattern.

  const periodParams = useMemo(() => {
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return null;
    }
    return { period_year: year, period_month: month };
  }, [year, month]);

  /** Load payroll month list (Admin monthly tab only) */
  useEffect(() => {
    if (auth.role !== "admin") return;
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
    if (auth.role !== "admin") return;
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
    if (auth.role !== "admin") return;
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
    if (auth.role !== "admin") return;
    if (!periodParams) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const [listData, sum] = await Promise.all([
          employeesApi.list({ ...periodParams, search: monthlySearch.trim() || undefined }),
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
  }, [toast, periodParams, auth.role, monthlySearch]);

  useEffect(() => {
    if (auth.role !== "finance") return;
    let alive = true;
    (async () => {
      setPendingLoading(true);
      try {
        const res = await employeePaymentsApi.pending({
          search: pendingSearch.trim() || undefined,
          overpaid: pendingOverpaidOnly ? true : undefined,
          sort: pendingSort
        });
        if (!alive) return;
        setPending(res);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setPendingLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [auth.role, toast, pendingSearch, pendingOverpaidOnly, pendingSort]);

  useEffect(() => {
    if (auth.role !== "admin") return;
    if (tab !== "contract") return;
    let alive = true;
    (async () => {
      setContractLoading(true);
      try {
        const res = await contractEmployeesApi.list({
          search: contractSearch.trim() || undefined,
          status: contractStatusFilter,
          overpaid: contractOverpaidOnly ? true : undefined
        });
        if (!alive) return;
        setContractRows(res);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setContractLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [auth.role, tab, toast, contractSearch, contractStatusFilter, contractOverpaidOnly, refreshToken]);

  // Drawer removed.

  function setPeriod(nextYear: number, nextMonth: number) {
    setSearchParams({ year: String(nextYear), month: String(nextMonth) });
  }

  const currentKey = Number.isFinite(year) && Number.isFinite(month) ? `${year}-${month}` : "";
  const selectedPeriod = nav?.periods.find((p) => p.year === year && p.month === month);
  const isViewingActive = selectedPeriod?.is_active === true;

  async function onStartNextMonth() {
    setConfirmStartMonthOpen(true);
  }

  async function confirmStartNextMonth() {
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

  function setTab(next: "monthly" | "contract" | "pending") {
    const sp = new URLSearchParams(searchParams);
    sp.set("tab", next);
    setSearchParams(sp);
  }

  return (
    <div className="space-y-6">
      {auth.role === "admin" ? (
        <div className="inline-flex rounded-2xl border border-black/10 bg-white p-1">
          <button
            type="button"
            onClick={() => setTab("monthly")}
            className={[
              "min-h-10 rounded-xl px-3 text-sm font-semibold",
              tab === "monthly" ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
            ].join(" ")}
          >
            Monthly Employees
          </button>
          <button
            type="button"
            onClick={() => setTab("contract")}
            className={[
              "min-h-10 rounded-xl px-3 text-sm font-semibold",
              tab === "contract" ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
            ].join(" ")}
          >
            Contract Employees
          </button>
        </div>
      ) : null}

      {auth.role === "admin" && selectedPeriod && !isViewingActive ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span className="font-semibold">Viewing archived month.</span> Payroll lines and payments cannot be changed here. Open{" "}
          <span className="font-semibold">{nav?.active_period?.label ?? "the active month"}</span> to edit.
        </div>
      ) : null}

      {auth.role === "admin" && tab === "monthly" && summary ? (
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

      {auth.role === "finance" ? (
        <Card>
          {pendingLoading ? (
            <div className="text-sm text-black/60">Loading…</div>
          ) : !pending || pending.items.length === 0 ? (
            <div className="text-sm text-black/60">No pending payments.</div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-black/55">Total pending</div>
                  <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(pending.total_pending_amount)}</div>
                </div>
                <Button
                  variant="secondary"
                  isLoading={pendingLoading}
                  onClick={() => {
                    setPendingLoading(true);
                    void employeePaymentsApi
                      .pending({
                        search: pendingSearch.trim() || undefined,
                        overpaid: pendingOverpaidOnly ? true : undefined,
                        sort: pendingSort
                      })
                      .then((res) => setPending(res))
                      .catch((e) => toast.push("error", getErrorMessage(e)))
                      .finally(() => setPendingLoading(false));
                  }}
                >
                  Refresh
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="text-xs font-semibold text-black/60">
                  Search employee
                  <input
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={pendingSearch}
                    onChange={(e) => setPendingSearch(e.target.value)}
                    placeholder="Name…"
                  />
                </label>
                <label className="text-xs font-semibold text-black/60">
                  Sort
                  <select
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={pendingSort}
                    onChange={(e) => setPendingSort(e.target.value as any)}
                  >
                    <option value="oldest">Oldest first</option>
                    <option value="newest">Newest first</option>
                    <option value="amount_desc">Highest amount</option>
                    <option value="amount_asc">Lowest amount</option>
                  </select>
                </label>
                <label className="flex items-end gap-2 text-xs font-semibold text-black/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={pendingOverpaidOnly}
                    onChange={(e) => setPendingOverpaidOnly(e.target.checked)}
                  />
                  Overpaid only (contract)
                </label>
              </div>
              <div className="md:hidden space-y-3">
                {pending.items.map((it) => (
                  <div key={it.transaction.id} className="rounded-2xl border border-black/10 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{it.employee_name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/70">
                            {it.employee_kind === "monthly" ? "Monthly" : "Contract"}
                          </span>
                          <span className="text-xs font-semibold text-black/55">{it.period_label ?? "—"}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-semibold text-black/55">Amount</div>
                        <div className="mt-0.5 text-base font-bold tabular-nums">{formatMoney(it.transaction.amount)}</div>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div>
                        <div className="text-xs font-semibold text-black/55">Receipt</div>
                        <div className="mt-1">
                          {it.transaction.receipt_url ? (
                            <Button
                              variant="secondary"
                              className="w-full"
                              onClick={() => setReceiptPreviewUrl(it.transaction.receipt_url ?? null)}
                            >
                              Preview receipt
                            </Button>
                          ) : (
                            <input
                              type="file"
                              className="block w-full text-sm"
                              disabled={pendingBusyId === it.transaction.id}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                setPendingBusyId(it.transaction.id);
                                void employeePaymentsApi
                                  .uploadReceipt(it.transaction.id, f)
                                  .then(() =>
                                    employeePaymentsApi.pending({
                                      search: pendingSearch.trim() || undefined,
                                      overpaid: pendingOverpaidOnly ? true : undefined,
                                      sort: pendingSort
                                    })
                                  )
                                  .then((res) => setPending(res))
                                  .catch((er) => toast.push("error", getErrorMessage(er)))
                                  .finally(() => setPendingBusyId(null));
                              }}
                            />
                          )}
                        </div>
                      </div>

                      {it.employee_kind === "contract" ? (
                        <Button variant="secondary" className="w-full" onClick={() => navigate("/finance")}>
                          Open in Finance
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          className="w-full"
                          disabled={pendingBusyId === it.transaction.id || !it.transaction.receipt_url}
                          isLoading={pendingBusyId === it.transaction.id}
                          onClick={() => setConfirmMarkPaid({ id: it.transaction.id })}
                        >
                          Mark paid
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block min-w-0 overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="text-black/60">
                    <tr className="border-b border-black/10">
                      <th className="py-3 pr-4 font-semibold">Employee</th>
                      <th className="py-3 pr-4 font-semibold">Kind</th>
                      <th className="py-3 pr-4 font-semibold">Period</th>
                      <th className="py-3 pr-4 text-right font-semibold">Amount</th>
                      <th className="py-3 pr-4 font-semibold">Receipt</th>
                      <th className="py-3 pr-0 text-right font-semibold"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.items.map((it) => (
                      <tr key={it.transaction.id} className="border-b border-black/5">
                        <td className="py-3 pr-4 font-semibold">{it.employee_name}</td>
                        <td className="py-3 pr-4">
                          <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/70">
                            {it.employee_kind === "monthly" ? "Monthly" : "Contract"}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                          {it.period_label ?? "—"}
                        </td>
                        <td className="py-3 pr-4 text-right font-bold tabular-nums">
                          {formatMoney(it.transaction.amount)}
                        </td>
                        <td className="py-3 pr-4">
                          {it.transaction.receipt_url ? (
                            <button
                              type="button"
                              className="text-sm font-semibold text-black underline decoration-black/30 underline-offset-2"
                              onClick={() => setReceiptPreviewUrl(it.transaction.receipt_url ?? null)}
                            >
                              Preview
                            </button>
                          ) : (
                            <input
                              type="file"
                              className="block text-sm"
                              disabled={pendingBusyId === it.transaction.id}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                setPendingBusyId(it.transaction.id);
                                void employeePaymentsApi
                                  .uploadReceipt(it.transaction.id, f)
                                  .then(() =>
                                    employeePaymentsApi.pending({
                                      search: pendingSearch.trim() || undefined,
                                      overpaid: pendingOverpaidOnly ? true : undefined,
                                      sort: pendingSort
                                    })
                                  )
                                  .then((res) => setPending(res))
                                  .catch((er) => toast.push("error", getErrorMessage(er)))
                                  .finally(() => setPendingBusyId(null));
                              }}
                            />
                          )}
                        </td>
                        <td className="py-3 pr-0 text-right">
                          {it.employee_kind === "contract" ? (
                            <Button variant="secondary" onClick={() => navigate("/finance")}>
                              Open in Finance
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              disabled={pendingBusyId === it.transaction.id || !it.transaction.receipt_url}
                              isLoading={pendingBusyId === it.transaction.id}
                              onClick={() => {
                                setConfirmMarkPaid({ id: it.transaction.id });
                              }}
                            >
                              Mark paid
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-xs text-black/50">
                Finance can only finalize pending payments and must upload a receipt first. Contract payments are finalized from the Finance page (job allocation required).
              </div>
            </div>
          )}
        </Card>
      ) : tab === "monthly" ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex flex-1 flex-col text-xs font-semibold text-black/60 sm:min-w-[220px]">
              Search employee
              <input
                className="mt-1 rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                value={monthlySearch}
                onChange={(e) => setMonthlySearch(e.target.value)}
                placeholder="Name…"
              />
            </label>
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
            <Button
              variant="secondary"
              isLoading={bulkSending}
              disabled={!selectedPeriod?.is_active || monthlySelectedIds.length === 0}
              onClick={() => {
                if (!periodParams) return;
                setBulkSending(true);
                const payload = {
                  items: monthlySelectedIds.map((id) => {
                    const r = rows.find((x) => x.id === id);
                    return {
                      employee_kind: "monthly" as const,
                      employee_id: id,
                      period_year: periodParams.period_year,
                      period_month: periodParams.period_month,
                      amount: r?.salary?.final_payable ?? 0,
                      note: bulkNote.trim() || null
                    };
                  })
                };
                void employeePaymentsApi
                  .bulkSend(payload)
                  .then((res) => toast.push("success", `Sent ${res.created} payment(s) to Finance.`))
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setBulkSending(false));
              }}
              title="Send selected employees to Finance in bulk"
            >
              Bulk Send to Finance
            </Button>
            <Link
              to={
                periodParams
                  ? `/employees/new?year=${periodParams.period_year}&month=${periodParams.period_month}`
                  : "/employees/new"
              }
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black/90 active:translate-y-[1px]"
            >
              Add employee
            </Link>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold text-black/60">
              Bulk note (optional)
              <input
                className="mt-1 w-[min(520px,100%)] rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
                placeholder="Note applied to all bulk sends"
              />
            </label>
            <Button
              variant="ghost"
              disabled={monthlySelectedIds.length === 0}
              onClick={() => setMonthlySelectedIds([])}
            >
              Clear selection
            </Button>
          </div>

          <Card>
            {!periodParams ? (
              <div className="space-y-3">
                <div className="text-sm font-semibold">Select a payroll month</div>
                <div className="text-sm text-black/60">
                  This page needs a <span className="font-semibold">year</span> and <span className="font-semibold">month</span> in the URL to load employees.
                </div>
                <div className="flex flex-wrap gap-2">
                  {nav?.active_period ? (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setSearchParams(
                          { year: String(nav.active_period!.year), month: String(nav.active_period!.month), tab: "monthly" },
                          { replace: true }
                        )
                      }
                    >
                      Go to active month ({nav.active_period.label})
                    </Button>
                  ) : (
                    <div className="text-sm text-black/60">Loading payroll months…</div>
                  )}
                </div>
              </div>
            ) : loading ? (
              <div className="text-sm text-black/60">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="text-sm text-black/60">No employees yet. Add one to get started.</div>
            ) : (
              <>
                <div className="md:hidden space-y-3">
                  {rows.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-2xl border border-black/10 bg-white p-4 cursor-pointer hover:bg-black/[0.02]"
                      role="link"
                      tabIndex={0}
                      onClick={(e) => {
                        if (isInteractiveTarget(e.target)) return;
                        navigate(`/employees/${r.id}/detail?year=${year}&month=${month}`);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        if (isInteractiveTarget(e.target)) return;
                        e.preventDefault();
                        navigate(`/employees/${r.id}/detail?year=${year}&month=${month}`);
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <label className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.full_name}`}
                            checked={monthlySelectedIds.includes(r.id)}
                            onChange={(e) => {
                              setMonthlySelectedIds((prev) =>
                                e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)
                              );
                            }}
                            className="mt-1 h-4 w-4"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold">{r.full_name}</div>
                            {r.notes ? <div className="mt-1 text-xs text-black/55 line-clamp-2">{r.notes}</div> : null}
                          </div>
                        </label>
                        <div className="text-right" aria-hidden="true">
                          <div className="text-xs font-semibold text-black/55"> </div>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span
                          className={
                            r.payment.status === "paid"
                              ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900"
                              : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
                          }
                        >
                          {r.payment.status === "paid" ? "Paid" : "Unpaid"}
                        </span>
                        <Button
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/employees/${r.id}/detail?year=${year}&month=${month}`);
                          }}
                        >
                          Open
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden md:block min-w-0 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-black/60">
                    <tr className="border-b border-black/10">
                      <th className="py-3 pr-4 font-semibold">
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={monthlySelectedIds.length > 0 && monthlySelectedIds.length === rows.length}
                          onChange={(e) => {
                            if (e.target.checked) setMonthlySelectedIds(rows.map((r) => r.id));
                            else setMonthlySelectedIds([]);
                          }}
                        />
                      </th>
                      <th className="py-3 pr-4 font-semibold">Name</th>
                      <th className="py-3 pr-4 font-semibold">Note</th>
                      <th className="py-3 pr-0 font-semibold">Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-black/5 cursor-pointer hover:bg-black/[0.02]"
                        role="link"
                        tabIndex={0}
                        onClick={(e) => {
                          if (isInteractiveTarget(e.target)) return;
                          navigate(`/employees/${r.id}/detail?year=${year}&month=${month}`);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          if (isInteractiveTarget(e.target)) return;
                          e.preventDefault();
                          navigate(`/employees/${r.id}/detail?year=${year}&month=${month}`);
                        }}
                      >
                        <td className="py-3 pr-4">
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.full_name}`}
                            checked={monthlySelectedIds.includes(r.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              setMonthlySelectedIds((prev) =>
                                e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)
                              );
                            }}
                          />
                        </td>
                        <td className="py-3 pr-4 font-semibold">{r.full_name}</td>
                        <td className="py-3 pr-4 text-xs text-black/60">
                          {r.notes ? <span className="line-clamp-2">{r.notes}</span> : "—"}
                        </td>
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
              </>
            )}
          </Card>
        </>
      ) : (
        <>
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex flex-1 flex-col text-xs font-semibold text-black/60 sm:min-w-[220px]">
                Search contract employee
                <input
                  className="mt-1 rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                  value={contractSearch}
                  onChange={(e) => setContractSearch(e.target.value)}
                  placeholder="Name…"
                />
              </label>
              <label className="flex flex-col text-xs font-semibold text-black/60 sm:min-w-[180px]">
                Status
                <select
                  className="mt-1 rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                  value={contractStatusFilter}
                  onChange={(e) => setContractStatusFilter(e.target.value as any)}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label className="flex items-end gap-2 text-xs font-semibold text-black/60">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={contractOverpaidOnly}
                  onChange={(e) => setContractOverpaidOnly(e.target.checked)}
                />
                Overpaid only
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs font-semibold text-black/60">
                Bulk amount (NGN)
                <input
                  className="mt-1 w-[220px] rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                  value={contractBulkAmt}
                  onChange={(e) => setContractBulkAmt(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                />
              </label>
              <label className="text-xs font-semibold text-black/60">
                Bulk note (optional)
                <input
                  className="mt-1 w-[min(520px,100%)] rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                  value={contractBulkNote}
                  onChange={(e) => setContractBulkNote(e.target.value)}
                  placeholder="Note applied to all bulk sends"
                />
              </label>
              <Button
                variant="secondary"
                isLoading={contractBulkSending}
                disabled={contractSelectedIds.length === 0}
                onClick={() => {
                  const amt = parseMoneyInput(contractBulkAmt);
                  if (contractBulkAmt.trim() && !isValidThousandsCommaNumber(contractBulkAmt)) {
                    toast.push("error", "Fix comma formatting in amount.");
                    return;
                  }
                  if (amt === null || Number.isNaN(amt) || amt <= 0) {
                    toast.push("error", "Enter a valid bulk amount (> 0).");
                    return;
                  }
                  setContractBulkSending(true);
                  void employeePaymentsApi
                    .bulkSend({
                      items: contractSelectedIds.map((id) => ({
                        employee_kind: "contract",
                        employee_id: id,
                        amount: amt,
                        note: contractBulkNote.trim() || null
                      }))
                    })
                    .then((res) => toast.push("success", `Sent ${res.created} payment(s) to Finance.`))
                    .catch((e) => toast.push("error", getErrorMessage(e)))
                    .finally(() => setContractBulkSending(false));
                }}
              >
                Bulk Send to Finance
              </Button>
              <Button variant="ghost" disabled={contractSelectedIds.length === 0} onClick={() => setContractSelectedIds([])}>
                Clear selection
              </Button>
              <Link
                to="/contract-employees/new?backTo=%2Femployees%3Ftab%3Dcontract"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black/90 active:translate-y-[1px]"
              >
                Create employee
              </Link>
            </div>

            {contractLoading ? (
              <div className="text-sm text-black/60">Loading…</div>
            ) : contractRows.length === 0 ? (
              <div className="text-sm text-black/60">No contract employees yet.</div>
            ) : (
              <>
                <div className="md:hidden space-y-3">
                  {contractRows.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-2xl border border-black/10 bg-white p-4"
                      role="link"
                      tabIndex={0}
                      onClick={() => navigate(`/contract-employees/${r.id}`)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        navigate(`/contract-employees/${r.id}`);
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <label
                          className="flex items-start gap-3"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.full_name}`}
                            checked={contractSelectedIds.includes(r.id)}
                            onChange={(e) => {
                              setContractSelectedIds((prev) =>
                                e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)
                              );
                            }}
                            className="mt-1 h-4 w-4"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold">{r.full_name}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/70">
                                {r.status === "active" ? "Active" : "Inactive"}
                              </span>
                              <span
                                className={[
                                  "inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold",
                                  (r.pending_requests ?? 0) > 0 ? "bg-emerald-600 text-white" : "bg-black/10 text-black/70"
                                ].join(" ")}
                              >
                                {typeof r.pending_requests === "number" ? r.pending_requests : 0} pending
                              </span>
                            </div>
                          </div>
                        </label>
                        <div className="text-right">
                          <div className="text-xs font-semibold text-black/55">Balance</div>
                          <div className="mt-0.5 text-base font-bold tabular-nums">{formatMoney(r.balance)}</div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                          <div className="font-semibold text-black/55">Owed</div>
                          <div className="mt-0.5 font-bold tabular-nums">{formatMoney(r.total_owed)}</div>
                        </div>
                        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                          <div className="font-semibold text-black/55">Paid</div>
                          <div className="mt-0.5 font-bold tabular-nums">{formatMoney(r.total_paid)}</div>
                        </div>
                        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                          <div className="font-semibold text-black/55">Active jobs</div>
                          <div className="mt-0.5 font-bold tabular-nums">
                            {typeof r.active_jobs_count === "number" ? r.active_jobs_count : 0}
                          </div>
                        </div>
                        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                          <div className="font-semibold text-black/55">Pending req</div>
                          <div className="mt-0.5 font-bold tabular-nums">
                            {typeof r.pending_requests === "number" ? r.pending_requests : 0}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3">
                        <Button
                          variant="secondary"
                          className="w-full"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/contract-employees/${r.id}`);
                          }}
                        >
                          Open
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden md:block min-w-0 overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="text-black/60">
                    <tr className="border-b border-black/10">
                      <th className="py-3 pr-4 font-semibold">
                        <input
                          type="checkbox"
                          aria-label="Select all contract employees"
                          checked={contractSelectedIds.length > 0 && contractSelectedIds.length === contractRows.length}
                          onChange={(e) => {
                            if (e.target.checked) setContractSelectedIds(contractRows.map((r) => r.id));
                            else setContractSelectedIds([]);
                          }}
                        />
                      </th>
                      <th className="py-3 pr-4 font-semibold">Name</th>
                      <th className="py-3 pr-4 font-semibold">Status</th>
                      <th className="py-3 pr-4 text-right font-semibold">Active jobs</th>
                      <th className="py-3 pr-4 text-right font-semibold">Pending requests</th>
                      <th className="py-3 pr-4 text-right font-semibold">Total owed</th>
                      <th className="py-3 pr-4 text-right font-semibold">Total paid</th>
                      <th className="py-3 pr-4 text-right font-semibold">Balance</th>
                      <th className="py-3 pr-0 text-right font-semibold"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {contractRows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-black/5 cursor-pointer hover:bg-black/[0.02]"
                        role="link"
                        tabIndex={0}
                        onClick={(e) => {
                          if (isInteractiveTarget(e.target)) return;
                          navigate(`/contract-employees/${r.id}`);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          if (isInteractiveTarget(e.target)) return;
                          e.preventDefault();
                          navigate(`/contract-employees/${r.id}`);
                        }}
                      >
                        <td className="py-3 pr-4">
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.full_name}`}
                            checked={contractSelectedIds.includes(r.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              setContractSelectedIds((prev) =>
                                e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)
                              );
                            }}
                          />
                        </td>
                        <td className="py-3 pr-4 font-semibold">
                          <Link
                            className="text-black underline decoration-black/30 underline-offset-2 hover:decoration-black/50"
                            to={`/contract-employees/${r.id}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.full_name}
                          </Link>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/70">
                            {r.status === "active" ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums">{typeof r.active_jobs_count === "number" ? r.active_jobs_count : 0}</td>
                        <td className="py-3 pr-4 text-right tabular-nums">
                          <span
                            className={[
                              "inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold",
                              (r.pending_requests ?? 0) > 0 ? "bg-emerald-600 text-white" : "bg-black/10 text-black/70"
                            ].join(" ")}
                          >
                            {typeof r.pending_requests === "number" ? r.pending_requests : 0}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums">{formatMoney(r.total_owed)}</td>
                        <td className="py-3 pr-4 text-right tabular-nums">{formatMoney(r.total_paid)}</td>
                        <td className="py-3 pr-4 text-right font-semibold tabular-nums">{formatMoney(r.balance)}</td>
                        <td className="py-3 pr-0 text-right">
                          <Link
                            className="text-sm font-semibold text-black underline decoration-black/30 underline-offset-2"
                            to={`/contract-employees/${r.id}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      {/* Side panel/drawer removed (monthly employees use dedicated detail page). */}

      <Modal open={receiptPreviewUrl !== null} title="Receipt preview" onClose={() => setReceiptPreviewUrl(null)}>
        {receiptPreviewUrl ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl border border-black/10">
              <iframe title="Receipt preview" src={receiptPreviewUrl} className="h-[70dvh] w-full" />
            </div>
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-black/5"
              href={receiptPreviewUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in new tab
            </a>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={confirmMarkPaid !== null}
        title="Confirm payment"
        onClose={() => (pendingBusyId ? null : setConfirmMarkPaid(null))}
      >
        {confirmMarkPaid ? (
          <div className="space-y-4">
            <div className="text-sm text-black/70">
              Confirm marking this transaction as <span className="font-semibold">Paid</span>?
            </div>
            {confirmMarkPaid.overpay ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                <span className="font-semibold">Overpaid.</span> This payment will make the employee owe the company.
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={confirmMarkPaid.overpay ? "danger" : "secondary"}
                disabled={pendingBusyId === confirmMarkPaid.id}
                isLoading={pendingBusyId === confirmMarkPaid.id}
                onClick={() => {
                  setPendingBusyId(confirmMarkPaid.id);
                  void employeePaymentsApi
                    .markPaid(confirmMarkPaid.id, confirmMarkPaid.overpay ? { confirm_overpay: true } : undefined)
                    .then(() =>
                      employeePaymentsApi.pending({
                        search: pendingSearch.trim() || undefined,
                        overpaid: pendingOverpaidOnly ? true : undefined,
                        sort: pendingSort
                      })
                    )
                    .then((res) => setPending(res))
                    .then(() => toast.push("success", "Marked paid."))
                    .then(() => setConfirmMarkPaid(null))
                    .catch((er: any) => {
                      const detail = er?.response?.data?.detail;
                      if (detail?.code === "OVERPAY_CONFIRM_REQUIRED") {
                        setConfirmMarkPaid({ id: confirmMarkPaid.id, overpay: true });
                        return;
                      }
                      toast.push("error", getErrorMessage(er));
                    })
                    .finally(() => setPendingBusyId(null));
                }}
              >
                {confirmMarkPaid.overpay ? "Confirm overpay" : "Confirm"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmMarkPaid(null)} disabled={pendingBusyId === confirmMarkPaid.id}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={confirmStartMonthOpen}
        title="Start new payroll month?"
        onClose={() => (startingMonth ? null : setConfirmStartMonthOpen(false))}
      >
        <div className="space-y-4">
          <div className="text-sm text-black/70">
            This will archive the current month (still viewable). Lateness, penalties, and bonuses start fresh in the new
            month; base salaries are unchanged.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              isLoading={startingMonth}
              onClick={() => {
                setConfirmStartMonthOpen(false);
                void confirmStartNextMonth();
              }}
            >
              Start new month
            </Button>
            <Button variant="ghost" onClick={() => setConfirmStartMonthOpen(false)} disabled={startingMonth}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={reverseTarget !== null} title="Reverse transaction" onClose={() => (reversing ? null : setReverseTarget(null))}>
        {reverseTarget ? (
          <div className="space-y-4">
            <div className="text-sm text-black/70">
              This does <span className="font-semibold">not delete</span> the original record. It creates a new reversal transaction.
            </div>
            <label className="text-xs font-semibold text-black/60">
              Reason (optional)
              <input
                className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="Reason…"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                isLoading={reversing}
                onClick={() => {
                  setReversing(true);
                  void employeePaymentsApi
                    .reverse(reverseTarget.id, { reason: reverseReason.trim() || undefined })
                    .then(() => toast.push("success", "Reversed."))
                    .then(() => {
                      setReverseTarget(null);
                      setReverseReason("");
                    })
                    .catch((e) => toast.push("error", getErrorMessage(e)))
                    .finally(() => setReversing(false));
                }}
              >
                Reverse transaction
              </Button>
              <Button variant="ghost" disabled={reversing} onClick={() => setReverseTarget(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={cancelTargetId !== null}
        title="Cancel pending payment"
        onClose={() => (cancelling ? null : setCancelTargetId(null))}
      >
        {cancelTargetId ? (
          <div className="space-y-4">
            <div className="text-sm text-black/70">Are you sure you want to cancel this pending payment?</div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                isLoading={cancelling}
                onClick={() => {
                  if (!cancelTargetId) return;
                  setCancelling(true);
                  void employeePaymentsApi
                    .cancelPending(cancelTargetId)
                    .then(() => toast.push("success", "Cancelled."))
                    .then(() => setCancelTargetId(null))
                    .catch((e) => toast.push("error", getErrorMessage(e)))
                    .finally(() => setCancelling(false));
                }}
              >
                Yes
              </Button>
              <Button variant="ghost" disabled={cancelling} onClick={() => setCancelTargetId(null)}>
                No
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
