import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { employeePaymentsApi, expensesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";

function financeListErrorMessage(err: unknown, section: "pending" | "history"): string {
  const raw = getErrorMessage(err);
  if (raw === "Request failed" || /^Request failed \(\d+\)$/.test(raw)) {
    return section === "history"
      ? "Unable to load transaction history. Please try again."
      : "Unable to load pending payments. Please try again.";
  }
  return raw;
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import type { ExpenseDailySummary, ExpenseEntry, ExpenseSummary, PendingEmployeePaymentItem, PendingEmployeePayments } from "../types/api";
import { formatLagosDateTime } from "../utils/datetime";
import { formatMoney } from "../utils/money";
import { canCancelUnpaidPaymentTransfer, getFinancialActivityStatusLabel } from "../utils/financialActivity";
import {
  getPendingMarkPaidDisabledReason,
  getPendingMarkPaidDisabledTooltip
} from "../utils/pendingPaymentMarkPaid";
import { usePageHeader } from "../components/layout/pageHeader";
import { MonthlyEmployeeAttendanceCard } from "../components/employee/MonthlyEmployeeAttendanceCard";
import { useMonthlyEmployeeAttendance } from "../hooks/useMonthlyEmployeeAttendance";
import { useContractPaymentAllocation } from "../hooks/useContractPaymentAllocation";
import { collectLinkedJobIds } from "../utils/paymentAllocation";

function formatFilterDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function FinanceDashboardPage() {
  const auth = useAuth();
  const toast = useToast();
  const monthlyAttendance = useMonthlyEmployeeAttendance();
  const [searchParams] = useSearchParams();
  const moneyRequestsView = searchParams.get("moneyRequests") === "1";
  const isFinanceRole = auth.role === "finance";
  const canFinalizePayments = isFinanceRole || auth.isAdmin;
  const showPaymentsPettyToggle = !isFinanceRole;
  const [section, setSection] = useState<"payments" | "petty_cash">(
    isFinanceRole && !moneyRequestsView ? "petty_cash" : "payments"
  );
  const [tab, setTab] = useState<"contract" | "monthly">("contract");
  const [pendingLoading, setPendingLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingEmployeePayments | null>(null);
  const [history, setHistory] = useState<PendingEmployeePayments | null>(null);
  const [pendingSort, setPendingSort] = useState<"oldest" | "newest" | "amount_desc" | "amount_asc">("oldest");
  const [historySort, setHistorySort] = useState<"oldest" | "newest" | "amount_desc" | "amount_asc">("newest");
  const [pendingSearch, setPendingSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const debouncedPendingSearch = useDebouncedValue(pendingSearch, 300);
  const debouncedHistorySearch = useDebouncedValue(historySearch, 300);
  const [pendingOffset, setPendingOffset] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const pageLimit = 20;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<null | { id: number; kind: "monthly" | "contract" }>(null);
  const [cancelTransferTarget, setCancelTransferTarget] = useState<null | {
    id: number;
    employeeName: string;
    amount: string | number;
  }>(null);
  const [cancellingTransfer, setCancellingTransfer] = useState(false);
  const [overpayConfirm, setOverpayConfirm] = useState(false);
  const [confirmWithoutReceipt, setConfirmWithoutReceipt] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTxnId, setDetailTxnId] = useState<number | null>(null);
  const [detail, setDetail] = useState<null | {
    transaction: any;
    employee_kind: "monthly" | "contract";
    employee_id: number;
    employee_name: string;
    bank_name?: string | null;
    account_number?: string | null;
    requested_amount: string | number;
    adjusted_amount?: string | number | null;
    jobs: Array<{ id: number; status: string; final_price?: string | number | null }>;
    note?: string | null;
  }>(null);
  const [detailReceiptName, setDetailReceiptName] = useState<string | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);

  // --- Petty cash (read-only view inside Finance) ---
  const [pettyLoading, setPettyLoading] = useState(false);
  const [pettyRows, setPettyRows] = useState<ExpenseEntry[]>([]);
  const [pettySummary, setPettySummary] = useState<ExpenseSummary | null>(null);
  const [pettyTotal, setPettyTotal] = useState(0);
  const [pettyOffset, setPettyOffset] = useState(0);
  const pettyPageLimit = 20;
  const [pettyFilterDate, setPettyFilterDate] = useState("");
  const [pettySearchQuery, setPettySearchQuery] = useState("");
  const debouncedPettySearch = useDebouncedValue(pettySearchQuery, 300);
  const [pettyDailySummary, setPettyDailySummary] = useState<ExpenseDailySummary | null>(null);
  const [pettyDetailFor, setPettyDetailFor] = useState<ExpenseEntry | null>(null);

  function fmtSentToFinanceDate(it: { sent_to_finance_at?: string | null; transaction: { created_at: string } }) {
    const raw = it.sent_to_finance_at ?? it.transaction.created_at;
    return formatLagosDateTime(raw);
  }

  const kindForTab = tab;

  async function refreshPending(next?: { offset?: number }) {
    const offset = typeof next?.offset === "number" ? next.offset : pendingOffset;
    const res = await employeePaymentsApi.pending({
      kind: kindForTab,
      queue_only: true,
      search: debouncedPendingSearch.trim() || undefined,
      sort: pendingSort,
      prioritize_employee_requests: moneyRequestsView,
      limit: pageLimit,
      offset
    });
    setPending(res);
    setPendingError(null);
    return res;
  }

  async function performCancelTransfer(transactionId: number) {
    setCancellingTransfer(true);
    try {
      await employeePaymentsApi.cancelPending(transactionId);
      await Promise.all([refreshPending({ offset: pendingOffset }), refreshHistory({ offset: historyOffset })]);
      window.dispatchEvent(new Event("furniture:notifications-updated"));
      toast.push("success", "Transfer cancelled.");
      setCancelTransferTarget(null);
      if (detailTxnId === transactionId) {
        setDetailOpen(false);
        setDetailTxnId(null);
        setDetail(null);
      }
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setCancellingTransfer(false);
    }
  }

  async function refreshHistory(next?: { offset?: number }) {
    const offset = typeof next?.offset === "number" ? next.offset : historyOffset;
    const res = await employeePaymentsApi.history({
      kind: kindForTab,
      search: debouncedHistorySearch.trim() || undefined,
      sort: historySort,
      limit: pageLimit,
      offset
    });
    setHistory(res);
    setHistoryError(null);
    return res;
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    return Boolean(el.closest('a,button,input,select,textarea,label,[role="button"],[role="checkbox"]'));
  }

  function fetchDetail(transactionId: number, opts?: { clearWhileLoading?: boolean }) {
    const clearWhileLoading = opts?.clearWhileLoading !== false;
    if (clearWhileLoading) {
      setDetail(null);
      setDetailLoading(true);
    }
    return employeePaymentsApi
      .detail(transactionId)
      .then((d) => {
        setDetail(d);
        window.dispatchEvent(new Event("furniture:notifications-updated"));
        return d;
      })
      .catch((e) => {
        toast.push("error", getErrorMessage(e));
        throw e;
      })
      .finally(() => {
        if (clearWhileLoading) setDetailLoading(false);
      });
  }

  function openDetail(transactionId: number) {
    setDetailOpen(true);
    setDetailTxnId(transactionId);
    setDetailReceiptName(null);
    void fetchDetail(transactionId, { clearWhileLoading: true });
  }

  async function refreshAfterMarkPaid() {
    await Promise.all([refreshPending({ offset: pendingOffset }), refreshHistory({ offset: historyOffset })]);
    window.dispatchEvent(new Event("furniture:notifications-updated"));
  }

  const contractPaymentAllocation = useContractPaymentAllocation({
    auth,
    busyId,
    setBusyId,
    onMarkedPaid: async () => {
      await refreshAfterMarkPaid();
      toast.push("success", "Marked paid.");
    },
    onError: (message) => toast.push("error", message)
  });

  function beginMarkPaidFromRow(it: PendingEmployeePaymentItem) {
    contractPaymentAllocation.beginMarkPaidFromPendingItem(it, (target) => {
      setConfirmTarget(target);
      setOverpayConfirm(false);
      setConfirmWithoutReceipt(auth.isAdmin && !it.transaction.receipt_url);
    });
  }

  function renderPendingRowActions(it: PendingEmployeePaymentItem) {
    const markPaidDisabledReason = getPendingMarkPaidDisabledReason(it, auth.role);
    const markPaidDisabled = markPaidDisabledReason !== null || busyId === it.transaction.id;
    const markPaidTooltip = getPendingMarkPaidDisabledTooltip(markPaidDisabledReason);
    const showCancelTransfer =
      auth.isAdmin && canCancelUnpaidPaymentTransfer(it.transaction.status);

    if (!canFinalizePayments && !showCancelTransfer) {
      return <span className="text-xs text-black/40">—</span>;
    }

    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canFinalizePayments ? (
          <span title={markPaidDisabled ? markPaidTooltip : undefined} className="inline-flex">
            <Button
              variant="secondary"
              className="shrink-0"
              disabled={markPaidDisabled}
              isLoading={busyId === it.transaction.id}
              onClick={(e) => {
                e.stopPropagation();
                beginMarkPaidFromRow(it);
              }}
            >
              Mark Paid
            </Button>
          </span>
        ) : null}
        {showCancelTransfer ? (
          <Button
            variant="danger"
            className="shrink-0"
            disabled={cancellingTransfer}
            onClick={(e) => {
              e.stopPropagation();
              setCancelTransferTarget({
                id: it.transaction.id,
                employeeName: it.employee_name,
                amount: it.transaction.amount
              });
            }}
          >
            Cancel Transfer
          </Button>
        ) : null}
      </div>
    );
  }

  useEffect(() => {
    setPendingOffset(0);
  }, [tab, pendingSort, debouncedPendingSearch, moneyRequestsView]);

  useEffect(() => {
    setHistoryOffset(0);
  }, [tab, historySort, debouncedHistorySearch]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setPendingLoading(true);
      setPendingError(null);
      try {
        await refreshPending({ offset: pendingOffset });
      } catch (e) {
        if (alive) setPendingError(financeListErrorMessage(e, "pending"));
      } finally {
        if (alive) setPendingLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pendingSort, debouncedPendingSearch, moneyRequestsView, pendingOffset]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        await refreshHistory({ offset: historyOffset });
      } catch (e) {
        if (alive) setHistoryError(financeListErrorMessage(e, "history"));
      } finally {
        if (alive) setHistoryLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, historySort, debouncedHistorySearch, historyOffset]);

  useEffect(() => {
    const onUpdated = () => {
      setPendingLoading(true);
      void refreshPending({ offset: pendingOffset })
        .catch((e) => toast.push("error", getErrorMessage(e)))
        .finally(() => setPendingLoading(false));
    };
    window.addEventListener("furniture:notifications-updated", onUpdated as EventListener);
    const iv = window.setInterval(() => {
      void refreshPending({ offset: pendingOffset }).catch(() => null);
    }, 15_000);
    return () => {
      window.removeEventListener("furniture:notifications-updated", onUpdated as EventListener);
      window.clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOffset, tab, pendingSort, pendingSearch, moneyRequestsView]);

  async function refreshPetty(next?: { offset?: number }) {
    const offset = typeof next?.offset === "number" ? next.offset : pettyOffset;
    const pageParams = {
      limit: pettyPageLimit,
      offset,
      ...(pettyFilterDate ? { entry_date: pettyFilterDate } : {}),
      ...(debouncedPettySearch.trim() ? { search: debouncedPettySearch.trim() } : {})
    };
    const [page, sum, daily] = await Promise.all([
      expensesApi.page(pageParams),
      expensesApi.summary(),
      pettyFilterDate
        ? expensesApi.dailySummary({ entry_date: pettyFilterDate, search: debouncedPettySearch.trim() || undefined })
        : Promise.resolve(null)
    ]);
    setPettyRows(page.items);
    setPettySummary(sum);
    setPettyTotal(page.total ?? 0);
    setPettyOffset(page.offset ?? offset);
    setPettyDailySummary(daily);
  }

  function clearPettyDateFilter() {
    setPettyFilterDate("");
    setPettyOffset(0);
  }

  useEffect(() => {
    if (!isFinanceRole) return;
    setSection(moneyRequestsView ? "payments" : "petty_cash");
  }, [isFinanceRole, moneyRequestsView]);

  useEffect(() => {
    if (section !== "petty_cash") return;
    let alive = true;
    (async () => {
      setPettyLoading(true);
      try {
        await refreshPetty({ offset: 0 });
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setPettyLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, toast, pettyFilterDate, debouncedPettySearch]);

  usePageHeader({
    title: "Finance Dashboard",
    subtitle:
      isFinanceRole && !moneyRequestsView
        ? "Attendance and petty cash."
        : "Contract payments and monthly salary payments — separated."
  });

  const pendingPage = pending ? Math.floor((pending.offset ?? 0) / (pending.limit || pageLimit)) + 1 : 1;
  const pendingTotalPages = pending ? Math.max(1, Math.ceil((pending.total || 0) / (pending.limit || pageLimit))) : 1;
  const historyPage = history ? Math.floor((history.offset ?? 0) / (history.limit || pageLimit)) + 1 : 1;
  const historyTotalPages = history ? Math.max(1, Math.ceil((history.total || 0) / (history.limit || pageLimit))) : 1;

  const contractPendingBadge = useMemo(() => {
    if (tab !== "contract") return 0;
    // Badge shows queue-only count for current tab; we rely on pending.total from queue_only=true.
    return typeof pending?.total === "number" ? pending.total : 0;
  }, [tab, pending?.total]);

  const monthlyDueBadge = useMemo(() => {
    if (tab !== "monthly") return 0;
    return typeof pending?.total === "number" ? pending.total : 0;
  }, [tab, pending?.total]);

  return (
    <div className="space-y-6">
      {monthlyAttendance.emp || monthlyAttendance.empLoading ? (
        <MonthlyEmployeeAttendanceCard
          empLoading={monthlyAttendance.empLoading}
          emp={monthlyAttendance.emp}
          attendance={monthlyAttendance.attendance}
          attBusy={monthlyAttendance.attBusy}
          clockRes={monthlyAttendance.clockRes}
          clockOutRes={monthlyAttendance.clockOutRes}
          todayEntry={monthlyAttendance.todayEntry}
          checkInAllowed={monthlyAttendance.checkInAllowed}
          checkOutAllowed={monthlyAttendance.checkOutAllowed}
          dayCompleted={monthlyAttendance.dayCompleted}
          onMarkAttendanceWithShift={monthlyAttendance.markAttendance}
          onRequestMarkAttendance={monthlyAttendance.requestMarkAttendance}
          onSignOutAttendance={monthlyAttendance.signOutAttendance}
          onRequestSignOut={monthlyAttendance.requestSignOut}
          shiftModalOpen={monthlyAttendance.shiftModalOpen}
          onShiftModalClose={() => monthlyAttendance.setShiftModalOpen(false)}
          signOutConfirmOpen={monthlyAttendance.signOutConfirmOpen}
          signOutPreview={monthlyAttendance.signOutPreview}
          onSignOutConfirmClose={() => monthlyAttendance.setSignOutConfirmOpen(false)}
          resultFeedback={monthlyAttendance.resultFeedback}
          onDismissResultFeedback={monthlyAttendance.dismissResultFeedback}
          showHistory
        />
      ) : null}
      {showPaymentsPettyToggle || (isFinanceRole && moneyRequestsView) ? (
        <Card className="!p-4">
          {showPaymentsPettyToggle ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-black/55">Sections</div>
                <div className="mt-1 text-lg font-bold">{section === "payments" ? "Payments" : "Petty Cash"}</div>
              </div>
              <div className="inline-flex w-full flex-wrap rounded-2xl border border-black/10 bg-white p-1 sm:w-auto">
                <button
                  type="button"
                  onClick={() => setSection("payments")}
                  className={[
                    "min-h-11 rounded-xl px-4 text-sm font-extrabold tracking-wide",
                    section === "payments" ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
                  ].join(" ")}
                  aria-pressed={section === "payments"}
                >
                  PAYMENTS
                </button>
                <button
                  type="button"
                  onClick={() => setSection("petty_cash")}
                  className={[
                    "min-h-11 rounded-xl px-4 text-sm font-extrabold tracking-wide",
                    section === "petty_cash" ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
                  ].join(" ")}
                  aria-pressed={section === "petty_cash"}
                >
                  PETTY CASH
                </button>
              </div>
            </div>
          ) : (
            <div className="text-lg font-bold">Payments</div>
          )}

          {section === "payments" ? (
            <div className={showPaymentsPettyToggle ? "mt-3" : ""}>
              <div className="inline-flex w-full flex-wrap rounded-2xl border border-black/10 bg-white p-1 sm:w-auto">
                <button
                  type="button"
                  onClick={() => setTab("contract")}
                  className={[
                    "min-h-11 rounded-xl px-4 text-sm font-extrabold tracking-wide",
                    tab === "contract" ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
                  ].join(" ")}
                  aria-pressed={tab === "contract"}
                >
                  CONTRACT EMPLOYEES{" "}
                  <span
                    className={[
                      "ml-2 inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold",
                      contractPendingBadge > 0 ? "bg-emerald-600 text-white" : "bg-black/10 text-black/70"
                    ].join(" ")}
                  >
                    Pending ({contractPendingBadge})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab("monthly")}
                  className={[
                    "min-h-11 rounded-xl px-4 text-sm font-extrabold tracking-wide",
                    tab === "monthly" ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
                  ].join(" ")}
                  aria-pressed={tab === "monthly"}
                >
                  MONTHLY EMPLOYEES{" "}
                  <span
                    className={[
                      "ml-2 inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold",
                      monthlyDueBadge > 0 ? "bg-amber-500 text-white" : "bg-black/10 text-black/70"
                    ].join(" ")}
                  >
                    Due ({monthlyDueBadge})
                  </span>
                </button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {section === "petty_cash" ? (
        <Card>
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="!p-4">
                <div className="text-xs font-semibold text-black/55">Total Received (credits)</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(pettySummary?.total_received ?? 0)}</div>
              </Card>
              <Card className="!p-4">
                <div className="text-xs font-semibold text-black/55">Total Expenses</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-red-800">{formatMoney(pettySummary?.total_expenses ?? 0)}</div>
              </Card>
              <Card className="!p-4">
                <div className="text-xs font-semibold text-black/55">Balance</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(pettySummary?.balance ?? 0)}</div>
              </Card>
              <Card className="!p-4">
                <div className="text-xs font-semibold text-black/55">Today’s expenses</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(pettySummary?.today_total ?? 0)}</div>
              </Card>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="text-sm font-bold">Petty cash history</div>
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="min-w-[180px] flex-1 text-xs font-semibold text-black/60">
                  Search
                  <input
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={pettySearchQuery}
                    onChange={(e) => {
                      setPettySearchQuery(e.target.value);
                      setPettyOffset(0);
                    }}
                    placeholder="Search notes…"
                  />
                </label>
                <label className="text-xs font-semibold text-black/60">
                  Date filter
                  <input
                    type="date"
                    className="mt-1 block rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={pettyFilterDate}
                    onChange={(e) => {
                      setPettyFilterDate(e.target.value);
                      setPettyOffset(0);
                    }}
                  />
                </label>
                {pettyFilterDate ? (
                  <Button variant="ghost" onClick={clearPettyDateFilter}>
                    Clear filter
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  isLoading={pettyLoading}
                  onClick={() => {
                    setPettyLoading(true);
                    void refreshPetty({ offset: pettyOffset })
                      .catch((e) => toast.push("error", getErrorMessage(e)))
                      .finally(() => setPettyLoading(false));
                  }}
                >
                  Refresh
                </Button>
              </div>

              {pettyFilterDate && pettyDailySummary ? (
                <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                  <div className="text-sm font-bold text-black">Daily Summary — {formatFilterDateLabel(pettyFilterDate)}</div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <div className="text-xs font-semibold text-black/55">Total Money In</div>
                      <div className="mt-1 text-base font-bold tabular-nums text-emerald-800">{formatMoney(pettyDailySummary.total_money_in)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-black/55">Total Money Out</div>
                      <div className="mt-1 text-base font-bold tabular-nums text-red-800">{formatMoney(pettyDailySummary.total_money_out)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-black/55">Number of Transactions</div>
                      <div className="mt-1 text-base font-bold tabular-nums">{pettyDailySummary.transaction_count}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              {pettyLoading ? (
                <div className="mt-3 text-sm text-black/60">Loading…</div>
              ) : pettyRows.length === 0 ? (
                <div className="mt-3 text-sm text-black/60">
                  {pettyFilterDate ? "No petty cash transactions found for this date." : "No entries yet."}
                </div>
              ) : (
                <>
                  <div className="mt-3 hidden md:block min-w-0 overflow-x-touch">
                    <table className="w-full min-w-[980px] text-left text-sm">
                      <thead className="text-black/60">
                        <tr className="border-b border-black/10">
                          <th className="py-3 pr-4 font-semibold">Date</th>
                          <th className="py-3 pr-4 font-semibold">Type</th>
                          <th className="py-3 pr-4 text-right font-semibold">Amount</th>
                          <th className="py-3 pr-4 font-semibold">Note</th>
                          <th className="py-3 pr-4 font-semibold">Receipt</th>
                          <th className="py-3 pr-0 font-semibold">Confirmed by</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pettyRows.map((r) => (
                          <tr
                            key={r.id}
                            className="border-b border-black/5 cursor-pointer hover:bg-black/[0.03]"
                            role="link"
                            tabIndex={0}
                            onClick={() => setPettyDetailFor(r)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" && e.key !== " ") return;
                              e.preventDefault();
                              setPettyDetailFor(r);
                            }}
                          >
                            <td className="py-3 pr-4 text-xs font-semibold text-black/60">{new Date(r.entry_date).toLocaleDateString()}</td>
                            <td className="py-3 pr-4 text-xs font-semibold text-black/60">{r.entry_type === "credit" ? "Credit" : "Expense"}</td>
                            <td className="py-3 pr-4 text-right font-bold tabular-nums">
                              {r.entry_type === "expense" ? "−" : "+"}
                              {formatMoney(r.amount)}
                            </td>
                            <td className="py-3 pr-4 text-xs text-black/60">{r.note ?? "—"}</td>
                            <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                              {r.receipt_url ? "Yes" : "—"}
                            </td>
                            <td className="py-3 pr-0 text-xs font-semibold text-black/60">
                              {r.processed_by ? r.processed_by : "—"} {r.processed_by_role ? `(${r.processed_by_role})` : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="text-xs font-semibold text-black/55">
                      Page {Math.floor(pettyOffset / pettyPageLimit) + 1} of {Math.max(1, Math.ceil((pettyTotal || 0) / pettyPageLimit))}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        disabled={pettyOffset <= 0 || pettyLoading}
                        onClick={() => {
                          const next = Math.max(0, pettyOffset - pettyPageLimit);
                          setPettyLoading(true);
                          void refreshPetty({ offset: next })
                            .catch((e) => toast.push("error", getErrorMessage(e)))
                            .finally(() => setPettyLoading(false));
                        }}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={pettyOffset + pettyPageLimit >= pettyTotal || pettyLoading}
                        onClick={() => {
                          const next = pettyOffset + pettyPageLimit;
                          setPettyLoading(true);
                          void refreshPetty({ offset: next })
                            .catch((e) => toast.push("error", getErrorMessage(e)))
                            .finally(() => setPettyLoading(false));
                        }}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      {section === "payments" ? (
      <Card>
        <div className="flex flex-col gap-6">
          <div>
            <div className="text-lg font-bold tracking-tight">
              {tab === "contract" ? "Contract Employee Payments" : "Monthly Salary Payments"}
            </div>
            <div className="mt-1 text-sm text-black/60">
              {tab === "contract"
                ? "Pending queue requires receipt; job allocation can be completed from Mark Paid when needed."
                : "Pending queue requires receipt; monthly salaries can be confirmed once paid."}
            </div>
            {moneyRequestsView ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <span className="font-semibold">Money request review.</span> Employee-initiated payment requests are shown first.
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-black/10 bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-black/55">Total pending (this section)</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(pending?.total_pending_amount ?? 0)}</div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-semibold text-black/60">
                  Search
                  <input
                    className="mt-1 w-full sm:w-[240px] rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={pendingSearch}
                    onChange={(e) => {
                      setPendingSearch(e.target.value);
                      setPendingOffset(0);
                    }}
                    placeholder="Employee name…"
                  />
                </label>
                <label className="text-xs font-semibold text-black/60">
                  Sort
                  <select
                    className="mt-1 rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={pendingSort}
                    onChange={(e) => {
                      setPendingSort(e.target.value as any);
                      setPendingOffset(0);
                    }}
                  >
                    <option value="oldest">Oldest first</option>
                    <option value="newest">Newest first</option>
                    <option value="amount_desc">Highest amount</option>
                    <option value="amount_asc">Lowest amount</option>
                  </select>
                </label>
                <Button
                  variant="secondary"
                  isLoading={pendingLoading}
                  onClick={() => {
                    setPendingLoading(true);
                    void refreshPending({ offset: pendingOffset })
                      .catch((e) => setPendingError(financeListErrorMessage(e, "pending")))
                      .finally(() => setPendingLoading(false));
                  }}
                >
                  Refresh
                </Button>
              </div>
            </div>

            {pendingLoading ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-black/60">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/15 border-t-black/60" aria-hidden />
                Loading pending payments…
              </div>
            ) : pendingError ? (
              <div className="mt-3 text-sm font-semibold text-red-700">{pendingError}</div>
            ) : !pending || pending.items.length === 0 ? (
              <div className="mt-3 text-sm text-black/60">No payments available</div>
            ) : (
              <>
                <div className="mt-3 md:hidden space-y-3">
                  {pending.items.map((it) => (
                    <div
                      key={it.transaction.id}
                      className={[
                        "cursor-pointer rounded-2xl border p-4 hover:bg-black/[0.03]",
                        it.notification_unread === true
                          ? "border-amber-300/90 bg-amber-50/60 ring-1 ring-amber-200/70"
                          : "border-black/10 bg-white"
                      ].join(" ")}
                      role="link"
                      tabIndex={0}
                      onClick={(e) => {
                        if (isInteractiveTarget(e.target)) return;
                        openDetail(it.transaction.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        if (isInteractiveTarget(e.target)) return;
                        e.preventDefault();
                        openDetail(it.transaction.id);
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-bold">{it.employee_name}</div>
                            {it.notification_unread === true ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-950">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                                Money Request
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs font-semibold text-black/55">
                            {fmtSentToFinanceDate(it as any)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-semibold text-black/55">Amount to Pay</div>
                          <div className="mt-0.5 text-base font-extrabold tabular-nums">{formatMoney(it.transaction.amount)}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-3">
                        <span className="text-xs font-semibold text-black/60">
                          {getFinancialActivityStatusLabel(it.transaction)}
                        </span>
                        {renderPendingRowActions(it)}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 hidden md:block min-w-0">
                  <table className="w-full text-left text-sm">
                    <thead className="text-black/60">
                      <tr className="border-b border-black/10">
                        <th className="py-3 pr-4 font-semibold">Employee</th>
                        <th className="py-3 pr-4 font-semibold">Date</th>
                        <th className="py-3 pr-4 font-semibold">Status</th>
                        <th className="py-3 pr-4 text-right font-semibold">Amount to Pay</th>
                        {canFinalizePayments || auth.isAdmin ? (
                          <th className="py-3 pr-0 text-right font-semibold">Actions</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {pending.items.map((it) => (
                        <tr
                          key={it.transaction.id}
                          className={[
                            "border-b cursor-pointer",
                            it.notification_unread === true
                              ? "border-amber-200/80 bg-amber-50/50 hover:bg-amber-50/80"
                              : "border-black/5 bg-black/[0.03] hover:bg-black/[0.05]"
                          ].join(" ")}
                          role="link"
                          tabIndex={0}
                          onClick={(e) => {
                            if (isInteractiveTarget(e.target)) return;
                            openDetail(it.transaction.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            if (isInteractiveTarget(e.target)) return;
                            e.preventDefault();
                            openDetail(it.transaction.id);
                          }}
                        >
                          <td className="py-3 pr-4 font-semibold">
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{it.employee_name}</span>
                              {it.notification_unread === true ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-950">
                                  Money Request
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                            {fmtSentToFinanceDate(it as any)}
                          </td>
                          <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                            {getFinancialActivityStatusLabel(it.transaction)}
                          </td>
                          <td className="py-3 pr-4 text-right font-extrabold tabular-nums">{formatMoney(it.transaction.amount)}</td>
                          {canFinalizePayments || auth.isAdmin ? (
                            <td className="py-3 pr-0 text-right">{renderPendingRowActions(it)}</td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="text-xs font-semibold text-black/55">
                    Page {pendingPage} of {pendingTotalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={pendingOffset <= 0 || pendingLoading}
                      onClick={() => {
                        const next = Math.max(0, pendingOffset - pageLimit);
                        setPendingOffset(next);
                        setPendingLoading(true);
                        void refreshPending({ offset: next })
                          .catch((e) => setPendingError(financeListErrorMessage(e, "pending")))
                          .finally(() => setPendingLoading(false));
                      }}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={pendingOffset + pageLimit >= (pending?.total ?? 0) || pendingLoading}
                      onClick={() => {
                        const next = pendingOffset + pageLimit;
                        setPendingOffset(next);
                        setPendingLoading(true);
                        void refreshPending({ offset: next })
                          .catch((e) => setPendingError(financeListErrorMessage(e, "pending")))
                          .finally(() => setPendingLoading(false));
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-black/10 bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="text-sm font-bold">Transaction History</div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-semibold text-black/60">
                  Search
                  <input
                    className="mt-1 w-full sm:w-[240px] rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={historySearch}
                    onChange={(e) => {
                      setHistorySearch(e.target.value);
                      setHistoryOffset(0);
                    }}
                    placeholder="Employee name…"
                  />
                </label>
                <label className="text-xs font-semibold text-black/60">
                  Sort
                  <select
                    className="mt-1 rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                    value={historySort}
                    onChange={(e) => {
                      setHistorySort(e.target.value as any);
                      setHistoryOffset(0);
                    }}
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="amount_desc">Highest amount</option>
                    <option value="amount_asc">Lowest amount</option>
                  </select>
                </label>
                <Button
                  variant="secondary"
                  isLoading={historyLoading}
                  onClick={() => {
                    setHistoryLoading(true);
                    void refreshHistory({ offset: historyOffset })
                      .catch((e) => setHistoryError(financeListErrorMessage(e, "history")))
                      .finally(() => setHistoryLoading(false));
                  }}
                >
                  Refresh
                </Button>
              </div>
            </div>

            {historyLoading ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-black/60">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/15 border-t-black/60" aria-hidden />
                Loading transaction history…
              </div>
            ) : historyError ? (
              <div className="mt-3 text-sm font-semibold text-red-700">{historyError}</div>
            ) : !history || history.items.length === 0 ? (
              <div className="mt-3 text-sm text-black/60">No transactions found.</div>
            ) : (
              <>
                <div className="mt-3 hidden md:block min-w-0 overflow-x-touch">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="text-black/60">
                      <tr className="border-b border-black/10">
                        <th className="py-3 pr-4 font-semibold">Employee</th>
                        <th className="py-3 pr-4 font-semibold">Period</th>
                        <th className="py-3 pr-4 font-semibold">Type</th>
                        <th className="py-3 pr-4 text-right font-semibold">Amount</th>
                        <th className="py-3 pr-4 font-semibold">Status</th>
                        <th className="py-3 pr-4 font-semibold">Confirmed by</th>
                        <th className="py-3 pr-0 text-right font-semibold">Last paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.items.map((it) => (
                        <tr
                          key={it.transaction.id}
                          className="border-b border-black/5 cursor-pointer hover:bg-black/[0.03]"
                          role="link"
                          tabIndex={0}
                          onClick={(e) => {
                            if (isInteractiveTarget(e.target)) return;
                            openDetail(it.transaction.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            if (isInteractiveTarget(e.target)) return;
                            e.preventDefault();
                            openDetail(it.transaction.id);
                          }}
                        >
                          <td className="py-3 pr-4 font-semibold">{it.employee_name}</td>
                          <td className="py-3 pr-4 text-xs font-semibold text-black/60">{it.period_label ?? "—"}</td>
                          <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                            {(it.transaction as any)?.initiated_by === "admin"
                              ? "Admin initiated"
                              : (it.transaction as any)?.initiated_by === "employee"
                                ? "Employee request"
                                : "—"}
                          </td>
                          <td className="py-3 pr-4 text-right font-bold tabular-nums">{formatMoney(it.transaction.amount)}</td>
                          <td className="py-3 pr-4 text-xs font-semibold text-black/60">{it.transaction.status}</td>
                          <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                            {(it.transaction as any)?.processed_by ? (it.transaction as any).processed_by : "—"}
                            {(it.transaction as any)?.processed_by_role ? ` (${(it.transaction as any).processed_by_role})` : ""}
                          </td>
                          <td className="py-3 pr-0 text-right text-xs font-semibold text-black/60">
                            {it.transaction.paid_at ? formatLagosDateTime(it.transaction.paid_at) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="text-xs font-semibold text-black/55">
                    Page {historyPage} of {historyTotalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={historyOffset <= 0 || historyLoading}
                      onClick={() => {
                        const next = Math.max(0, historyOffset - pageLimit);
                        setHistoryOffset(next);
                        setHistoryLoading(true);
                        void refreshHistory({ offset: next })
                          .catch((e) => setHistoryError(financeListErrorMessage(e, "history")))
                          .finally(() => setHistoryLoading(false));
                      }}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={historyOffset + pageLimit >= (history?.total ?? 0) || historyLoading}
                      onClick={() => {
                        const next = historyOffset + pageLimit;
                        setHistoryOffset(next);
                        setHistoryLoading(true);
                        void refreshHistory({ offset: next })
                          .catch((e) => setHistoryError(financeListErrorMessage(e, "history")))
                          .finally(() => setHistoryLoading(false));
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>
      ) : null}

      <Modal
        open={detailOpen}
        title="Payment request"
        onClose={() => (detailLoading || sendBusy ? null : setDetailOpen(false))}
      >
        <div className="space-y-4">
          {detailLoading ? (
            <div className="text-sm text-black/60">Loading…</div>
          ) : !detail ? (
            <div className="text-sm text-black/60">Not found.</div>
          ) : (
            <>
              <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-3 text-sm">
                <div className="text-xs font-semibold text-black/55">Employee info</div>
                <div className="mt-1 min-w-0 break-words text-base font-bold text-black">{detail.employee_name}</div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-black/55">Bank</div>
                    <div className="mt-0.5 min-w-0 break-words font-semibold text-black">
                      {detail.bank_name ? detail.bank_name : "—"}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-black/55">Account number</div>
                    <div className="mt-0.5 min-w-0 break-words font-semibold text-black">
                      {detail.account_number ? detail.account_number : "—"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-black/10 bg-white p-3 text-sm">
                <div className="text-xs font-semibold text-black/55">Payment details</div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-black/55">Requested amount</div>
                    <div className="mt-0.5 font-bold tabular-nums text-black">{formatMoney(detail.requested_amount ?? 0)}</div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-black/55">Amount to Pay</div>
                        {(detail.transaction as any)?.initiated_by ? (
                          <span
                            className={[
                              "rounded-full px-2 py-0.5 text-[11px] font-bold",
                              (detail.transaction as any).initiated_by === "admin"
                                ? "bg-blue-100 text-blue-900"
                                : "bg-purple-100 text-purple-900"
                            ].join(" ")}
                          >
                            {(detail.transaction as any).initiated_by === "admin" ? "Admin initiated" : "Employee requested"}
                          </span>
                        ) : null}
                      {detail.adjusted_amount ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                          Adjusted
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 font-bold tabular-nums text-emerald-700">
                      {formatMoney(
                        (detail.transaction?.amount ?? detail.adjusted_amount ?? detail.requested_amount) as any
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-black/55">Created</div>
                    <div className="mt-0.5 text-xs font-semibold text-black/70">
                      {detail.transaction?.created_at ? formatLagosDateTime(detail.transaction.created_at) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-black/55">Paid/confirmed at</div>
                    <div className="mt-0.5 text-xs font-semibold text-black/70">
                      {detail.transaction?.paid_at ? formatLagosDateTime(detail.transaction.paid_at) : "—"}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-xs font-semibold text-black/55">Paid/confirmed by</div>
                    <div className="mt-0.5 text-xs font-semibold text-black/70">
                      {(detail.transaction as any)?.processed_by ? (detail.transaction as any).processed_by : "—"}
                      {(detail.transaction as any)?.processed_by_role ? ` (${(detail.transaction as any).processed_by_role})` : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-xs font-semibold text-black/55">Notes</div>
                  <div className="mt-1 text-sm text-black/70 break-words">{detail.note ?? "—"}</div>
                </div>
              </div>

              {detail.employee_kind === "contract" &&
              (detail.jobs?.length || detail.transaction?.contract_job_id) ? (
                <div>
                  <div className="text-xs font-semibold text-black/55">Linked jobs</div>
                  <ul className="mt-2 divide-y divide-black/10 rounded-2xl border border-black/10">
                    {(detail.jobs?.length
                      ? detail.jobs
                      : [{ id: Number(detail.transaction.contract_job_id), status: "linked", final_price: null }]
                    )
                      .slice(0, 10)
                      .map((j) => (
                      <li key={j.id} className="px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 break-words font-semibold">Job #{j.id}</div>
                          <div className="text-xs font-semibold text-black/55">{j.status}</div>
                        </div>
                        <div className="mt-1 text-xs text-black/60">
                          Final price: {j.final_price ? formatMoney(j.final_price) : "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="rounded-2xl border border-black/10 bg-white p-3 text-sm">
                <div className="text-xs font-semibold text-black/55">Receipt</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {detail.transaction?.receipt_url ? (
                    <Button variant="secondary" onClick={() => setPreviewUrl(detail.transaction.receipt_url ?? null)}>
                      Preview receipt
                    </Button>
                  ) : (
                    <>
                      <input
                        ref={receiptInputRef}
                        type="file"
                        className="hidden"
                        disabled={busyId === detail.transaction?.id || !detail.transaction?.id}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f || !detail.transaction?.id) return;
                          setDetailReceiptName(f.name);
                          const txnId = detail.transaction.id;
                          setBusyId(txnId);
                          void employeePaymentsApi
                            .uploadReceipt(txnId, f)
                            .then((updatedTxn) => {
                              setDetail((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      transaction: {
                                        ...prev.transaction,
                                        ...updatedTxn,
                                        receipt_url: updatedTxn.receipt_url ?? prev.transaction?.receipt_url
                                      }
                                    }
                                  : prev
                              );
                              setDetailReceiptName(null);
                              return fetchDetail(txnId, { clearWhileLoading: false });
                            })
                            .then(() => toast.push("success", "Receipt uploaded."))
                            .catch((er) => toast.push("error", getErrorMessage(er)))
                            .finally(() => {
                              setBusyId(null);
                              // allow selecting the same file again
                              if (receiptInputRef.current) receiptInputRef.current.value = "";
                            });
                        }}
                      />

                      <div className="inline-flex">
                        <input
                          type="button"
                          className="hidden"
                          aria-hidden="true"
                        />
                        <Button
                          variant="secondary"
                          type="button"
                          isLoading={busyId === detail.transaction?.id}
                          disabled={busyId === detail.transaction?.id || !detail.transaction?.id}
                          onClick={() => receiptInputRef.current?.click()}
                        >
                          Upload Receipt
                        </Button>
                      </div>
                      <div className="min-w-0 text-xs font-semibold text-black/55">
                        {detailReceiptName ? (
                          <span className="break-words">Selected: {detailReceiptName}</span>
                        ) : (
                          <span>No file selected</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="-mx-4 sticky bottom-0 border-t border-black/10 bg-white px-4 py-3 sm:-mx-6 sm:px-6">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {auth.isAdmin &&
                  detail.transaction?.id &&
                  canCancelUnpaidPaymentTransfer(detail.transaction.status) ? (
                    <Button
                      variant="danger"
                      disabled={cancellingTransfer || sendBusy}
                      onClick={() => {
                        if (!detail.transaction?.id) return;
                        setCancelTransferTarget({
                          id: detail.transaction.id,
                          employeeName: detail.employee_name,
                          amount: detail.transaction.amount
                        });
                      }}
                    >
                      Cancel Transfer
                    </Button>
                  ) : null}
                  {auth.isAdmin ? (
                    <Button
                      variant="secondary"
                      isLoading={sendBusy}
                      disabled={
                        sendBusy ||
                        !detailTxnId ||
                        detail.transaction?.status === "paid" ||
                        detail.transaction?.status === "cancelled" ||
                        detail.transaction?.status === "sent_to_finance" ||
                        detail.transaction?.status === "pending"
                      }
                      onClick={() => {
                        if (!detailTxnId) return;
                        setSendBusy(true);
                        void employeePaymentsApi
                          .sendToFinance(detailTxnId)
                    .then(() => Promise.all([refreshPending({ offset: pendingOffset }), refreshHistory({ offset: historyOffset })]))
                    .then(() => window.dispatchEvent(new Event("furniture:notifications-updated")))
                    .then(() => toast.push("success", "Sent to Finance."))
                          .then(() => setDetailOpen(false))
                          .catch((e) => toast.push("error", getErrorMessage(e)))
                          .finally(() => setSendBusy(false));
                      }}
                    >
                      Send to Finance
                    </Button>
                  ) : null}

                  <Button
                    variant="secondary"
                    disabled={
                      !detail.transaction?.id ||
                      busyId === detail.transaction?.id ||
                      (auth.role === "finance" && !detail.transaction?.receipt_url) ||
                      detail.transaction?.status === "paid" ||
                      detail.transaction?.status === "cancelled"
                    }
                    title={
                      auth.role === "finance" && !detail.transaction?.receipt_url
                        ? "Upload a receipt before marking this payment as paid."
                        : undefined
                    }
                    isLoading={busyId === detail.transaction?.id}
                    onClick={() => {
                      const txId = detail.transaction?.id;
                      if (!txId) return;
                      if (detail.employee_kind === "contract") {
                        const linkedJobs = detail.jobs ?? [];
                        contractPaymentAllocation.openForPayment({
                          transactionId: txId,
                          employeeId: detail.employee_id,
                          employeeName: detail.employee_name,
                          amount: detail.transaction?.amount ?? "",
                          linkedJobs,
                          linkedJobIds: collectLinkedJobIds(linkedJobs, detail.transaction?.contract_job_id),
                          contractJobId: detail.transaction?.contract_job_id,
                          receiptUrl: detail.transaction?.receipt_url
                        });
                        return;
                      }
                      setConfirmTarget({ id: txId, kind: "monthly" });
                      setOverpayConfirm(false);
                      setConfirmWithoutReceipt(auth.isAdmin && !detail.transaction?.receipt_url);
                    }}
                  >
                    Mark Paid
                  </Button>
                  <Button variant="ghost" disabled={sendBusy} onClick={() => setDetailOpen(false)}>
                    Close
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={pettyDetailFor !== null} title="Petty cash entry" onClose={() => setPettyDetailFor(null)}>
        {pettyDetailFor ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-black/10 bg-white p-3 text-sm">
              <div className="text-xs font-semibold text-black/55">Date/time</div>
              <div className="mt-0.5 font-bold">{formatLagosDateTime(pettyDetailFor.entry_date)}</div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-black/55">Type</div>
                  <div className="mt-0.5 font-semibold">{pettyDetailFor.entry_type === "credit" ? "Credit" : "Expense"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-black/55">Amount</div>
                  <div className="mt-0.5 font-extrabold tabular-nums">
                    {pettyDetailFor.entry_type === "expense" ? "−" : "+"}
                    {formatMoney(pettyDetailFor.amount)}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-xs font-semibold text-black/55">Confirmed by</div>
                  <div className="mt-0.5 text-xs font-semibold text-black/70">
                    {pettyDetailFor.processed_by ? pettyDetailFor.processed_by : "—"}
                    {pettyDetailFor.processed_by_role ? ` (${pettyDetailFor.processed_by_role})` : ""}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <div className="text-xs font-semibold text-black/55">Note</div>
                <div className="mt-1 text-sm text-black/70 break-words">{pettyDetailFor.note ?? "—"}</div>
              </div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white p-3 text-sm">
              <div className="text-xs font-semibold text-black/55">Receipt</div>
              <div className="mt-2">
                {pettyDetailFor.receipt_url ? (
                  <Button variant="secondary" onClick={() => setPreviewUrl(pettyDetailFor.receipt_url ?? null)}>
                    Preview receipt
                  </Button>
                ) : (
                  <div className="text-sm text-black/60">No receipt uploaded.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={previewUrl !== null} title="Receipt preview" onClose={() => setPreviewUrl(null)}>
        {previewUrl ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl border border-black/10">
              <iframe title="Receipt preview" src={previewUrl} className="h-[70dvh] w-full" />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={confirmTarget !== null} title="Confirm Payment" onClose={() => (busyId ? null : setConfirmTarget(null))}>
        {confirmTarget ? (
          <div className="space-y-4">
            <div className="text-sm text-black/70">
              {confirmWithoutReceipt ? (
                <>Are you sure you want to proceed without a receipt?</>
              ) : (
                <>
                  Are you sure you want to mark this payment as paid?
                  <div className="mt-2">
                    This action will complete the payment and update the employee&apos;s financial records.
                  </div>
                </>
              )}
            </div>
            {overpayConfirm ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                <span className="font-semibold">Overpaid.</span> This payment will make the employee owe the company.
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                disabled={busyId === confirmTarget.id}
                onClick={() => {
                  setConfirmTarget(null);
                  setConfirmWithoutReceipt(false);
                  setOverpayConfirm(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant={overpayConfirm ? "danger" : "secondary"}
                isLoading={busyId === confirmTarget.id}
                disabled={busyId === confirmTarget.id}
                onClick={() => {
                  setBusyId(confirmTarget.id);
                  const options =
                    overpayConfirm || confirmWithoutReceipt
                      ? {
                          confirm_overpay: overpayConfirm ? true : undefined,
                          confirm_without_receipt: confirmWithoutReceipt ? true : undefined
                        }
                      : undefined;
                  void employeePaymentsApi
                    .markPaid(confirmTarget.id, options)
                    .then(() => refreshAfterMarkPaid())
                    .then(() => toast.push("success", "Marked paid."))
                    .then(() => {
                      setConfirmTarget(null);
                      if (detailTxnId === confirmTarget.id) {
                        setDetailOpen(false);
                        setDetailTxnId(null);
                        setDetail(null);
                      }
                    })
                    .catch((er: any) => {
                      const detail = er?.response?.data?.detail;
                      if (detail?.code === "OVERPAY_CONFIRM_REQUIRED") {
                        setOverpayConfirm(true);
                        return;
                      }
                      toast.push("error", getErrorMessage(er));
                    })
                    .finally(() => setBusyId(null));
                }}
              >
                {overpayConfirm ? "Confirm overpay" : confirmWithoutReceipt ? "Yes" : "Mark Paid"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {contractPaymentAllocation.modal}

      <Modal
        open={cancelTransferTarget !== null}
        title="Cancel transfer"
        onClose={() => (cancellingTransfer ? null : setCancelTransferTarget(null))}
      >
        {cancelTransferTarget ? (
          <div className="space-y-4">
            <p className="text-sm text-black/70">
              Are you sure you want to cancel this pending transfer for{" "}
              <span className="font-semibold">{cancelTransferTarget.employeeName}</span> (
              {formatMoney(cancelTransferTarget.amount)})? This cannot be undone; Finance will no longer see it as
              payable.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={cancellingTransfer} onClick={() => setCancelTransferTarget(null)}>
                Keep transfer
              </Button>
              <Button
                variant="danger"
                isLoading={cancellingTransfer}
                onClick={() => void performCancelTransfer(cancelTransferTarget.id)}
              >
                Cancel transfer
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

