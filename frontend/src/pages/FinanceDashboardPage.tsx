import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { contractEmployeesApi, employeePaymentsApi, expensesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import type { ExpenseEntry, ExpenseSummary, PendingEmployeePayments } from "../types/api";
import { formatMoney } from "../utils/money";
import { parseMoneyInput, sanitizeMoneyInput } from "../utils/moneyInput";
import { usePageHeader } from "../components/layout/pageHeader";

export function FinanceDashboardPage() {
  const auth = useAuth();
  const toast = useToast();
  const [section, setSection] = useState<"payments" | "petty_cash">("payments");
  const [tab, setTab] = useState<"contract" | "monthly">("contract");
  const [pendingLoading, setPendingLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [pending, setPending] = useState<PendingEmployeePayments | null>(null);
  const [history, setHistory] = useState<PendingEmployeePayments | null>(null);
  const [pendingSort, setPendingSort] = useState<"oldest" | "newest" | "amount_desc" | "amount_asc">("oldest");
  const [historySort, setHistorySort] = useState<"oldest" | "newest" | "amount_desc" | "amount_asc">("newest");
  const [pendingSearch, setPendingSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [pendingOffset, setPendingOffset] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const pageLimit = 20;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<null | { id: number; kind: "monthly" | "contract" }>(null);
  const [allocOpen, setAllocOpen] = useState(false);
  const [allocLoading, setAllocLoading] = useState(false);
  const [allocTxId, setAllocTxId] = useState<number | null>(null);
  const [allocEmployeeId, setAllocEmployeeId] = useState<number | null>(null);
  const [allocEmployeeName, setAllocEmployeeName] = useState<string>("");
  const [allocAmount, setAllocAmount] = useState<string>("");
  const [allocJobs, setAllocJobs] = useState<
    Array<{ id: number; status: string; final_price?: string | number | null; amount_paid: string | number; balance?: string | number | null }>
  >([]);
  const [allocLines, setAllocLines] = useState<Record<number, string>>({});
  const [overpayConfirm, setOverpayConfirm] = useState(false);
  const [confirmWithoutReceipt, setConfirmWithoutReceipt] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTxnId, setDetailTxnId] = useState<number | null>(null);
  const [detail, setDetail] = useState<null | {
    transaction: any;
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
  const [pettyDetailFor, setPettyDetailFor] = useState<ExpenseEntry | null>(null);

  function fmtSentToFinanceDate(it: { sent_to_finance_at?: string | null; transaction: { created_at: string } }) {
    const raw = it.sent_to_finance_at ?? it.transaction.created_at;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  }

  function toFiniteNumber(x: unknown): number | null {
    if (typeof x === "number") return Number.isFinite(x) ? x : null;
    if (typeof x === "string") {
      const n = Number(sanitizeMoneyInput(x));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  const activeAllocJobs = useMemo(() => {
    return allocJobs.filter((j) => {
      const bal = toFiniteNumber(j.balance);
      if (bal === null) return false;
      if (bal <= 0) return false;
      // Allocations are allowed for any non-cancelled job with an outstanding balance.
      // (Jobs may be "completed" but still unpaid/partially paid.)
      return j.status !== "cancelled";
    });
  }, [allocJobs]);

  useEffect(() => {
    // Smart default: when modal opens (and jobs are loaded), auto-select smallest-balance active job
    // and auto-fill with min(payment, remaining balance).
    if (!allocOpen) return;
    if (allocLoading) return;
    if (Object.keys(allocLines).length > 0) return;
    if (activeAllocJobs.length === 0) return;

    const pay = parseMoneyInput(allocAmount);
    const payAmount = pay === null || Number.isNaN(pay) ? 0 : pay;

    let chosenIdx = 0;
    let chosenBal = toFiniteNumber(activeAllocJobs[0]?.balance) ?? Number.POSITIVE_INFINITY;
    for (let i = 1; i < activeAllocJobs.length; i++) {
      const bal = toFiniteNumber(activeAllocJobs[i]?.balance);
      if (bal === null) continue;
      if (bal < chosenBal) {
        chosenBal = bal;
        chosenIdx = i;
      }
    }
    const chosen = activeAllocJobs[chosenIdx];
    const remaining = toFiniteNumber(chosen.balance) ?? 0;
    const autoAlloc = Math.max(0, Math.min(payAmount, remaining));

    setAllocLines({ [chosen.id]: autoAlloc > 0 ? String(autoAlloc) : "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocOpen, allocLoading, activeAllocJobs, allocAmount]);

  function setAllocation(jobId: number, raw: string, maxBalance: unknown) {
    const n = parseMoneyInput(raw);
    if (n !== null && !Number.isNaN(n)) {
      const max = toFiniteNumber(maxBalance);
      if (max !== null) {
        const clamped = Math.max(0, Math.min(n, max));
        setAllocLines({ ...allocLines, [jobId]: String(clamped) });
        return;
      }
    }
    setAllocLines({ ...allocLines, [jobId]: raw });
  }

  const kindForTab = tab;

  async function refreshPending(next?: { offset?: number }) {
    const offset = typeof next?.offset === "number" ? next.offset : pendingOffset;
    const res = await employeePaymentsApi.pending({
      kind: kindForTab,
      queue_only: true,
      search: pendingSearch.trim() || undefined,
      sort: pendingSort,
      limit: pageLimit,
      offset
    });
    setPending(res);
  }

  async function refreshHistory(next?: { offset?: number }) {
    const offset = typeof next?.offset === "number" ? next.offset : historyOffset;
    const res = await employeePaymentsApi.history({
      kind: kindForTab,
      search: historySearch.trim() || undefined,
      sort: historySort,
      limit: pageLimit,
      offset
    });
    setHistory(res);
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    return Boolean(el.closest('a,button,input,select,textarea,label,[role="button"],[role="checkbox"]'));
  }

  function openDetail(transactionId: number) {
    setDetailOpen(true);
    setDetailTxnId(transactionId);
    setDetail(null);
    setDetailLoading(true);
    setDetailReceiptName(null);
    void employeePaymentsApi
      .detail(transactionId)
      .then((d) => setDetail(d))
      .catch((e) => toast.push("error", getErrorMessage(e)))
      .finally(() => setDetailLoading(false));
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setPendingLoading(true);
      setHistoryLoading(true);
      try {
        await Promise.all([refreshPending({ offset: 0 }), refreshHistory({ offset: 0 })]);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) {
          setPendingOffset(0);
          setHistoryOffset(0);
          setPendingLoading(false);
          setHistoryLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, tab, pendingSort, pendingSearch, historySort, historySearch]);

  async function refreshPetty(next?: { offset?: number }) {
    const offset = typeof next?.offset === "number" ? next.offset : pettyOffset;
    const [page, sum] = await Promise.all([
      expensesApi.page({ limit: pettyPageLimit, offset }),
      expensesApi.summary()
    ]);
    setPettyRows(page.items);
    setPettySummary(sum);
    setPettyTotal(page.total ?? 0);
    setPettyOffset(page.offset ?? offset);
  }

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
  }, [section, toast]);

  usePageHeader({
    title: "Finance Dashboard",
    subtitle: "Contract payments and monthly salary payments — separated."
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
      <Card className="!p-4">
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

        {section === "payments" ? (
          <div className="mt-3 inline-flex w-full flex-wrap rounded-2xl border border-black/10 bg-white p-1 sm:w-auto">
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
        ) : null}
      </Card>

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

              {pettyLoading ? (
                <div className="mt-3 text-sm text-black/60">Loading…</div>
              ) : pettyRows.length === 0 ? (
                <div className="mt-3 text-sm text-black/60">No entries yet.</div>
              ) : (
                <>
                  <div className="mt-3 hidden md:block min-w-0 overflow-x-auto">
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
                ? "Pending queue requires receipt; contract payments also require job allocation."
                : "Pending queue requires receipt; monthly salaries can be confirmed once paid."}
            </div>
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
                      .catch((e) => toast.push("error", getErrorMessage(e)))
                      .finally(() => setPendingLoading(false));
                  }}
                >
                  Refresh
                </Button>
              </div>
            </div>

            {pendingLoading ? (
              <div className="mt-3 text-sm text-black/60">Loading…</div>
            ) : !pending || pending.items.length === 0 ? (
              <div className="mt-3 text-sm text-black/60">No payments available</div>
            ) : (
              <>
                <div className="mt-3 md:hidden space-y-3">
                  {pending.items.map((it) => (
                    <div
                      key={it.transaction.id}
                      className="cursor-pointer rounded-2xl border border-black/10 bg-white p-4 hover:bg-black/[0.03]"
                      role="link"
                      tabIndex={0}
                      onClick={() => openDetail(it.transaction.id)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        openDetail(it.transaction.id);
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold">{it.employee_name}</div>
                          <div className="mt-1 text-xs font-semibold text-black/55">
                            {fmtSentToFinanceDate(it as any)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-semibold text-black/55">Amount to Pay</div>
                          <div className="mt-0.5 text-base font-extrabold tabular-nums">{formatMoney(it.transaction.amount)}</div>
                        </div>
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
                        <th className="py-3 pr-0 text-right font-semibold">Amount to Pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.items.map((it) => (
                        <tr
                          key={it.transaction.id}
                          className="border-b border-black/5 bg-black/[0.03] cursor-pointer hover:bg-black/[0.05]"
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
                          <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                            {fmtSentToFinanceDate(it as any)}
                          </td>
                          <td className="py-3 pr-0 text-right font-extrabold tabular-nums">{formatMoney(it.transaction.amount)}</td>
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
                          .catch((e) => toast.push("error", getErrorMessage(e)))
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
                          .catch((e) => toast.push("error", getErrorMessage(e)))
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
                      .catch((e) => toast.push("error", getErrorMessage(e)))
                      .finally(() => setHistoryLoading(false));
                  }}
                >
                  Refresh
                </Button>
              </div>
            </div>

            {historyLoading ? (
              <div className="mt-3 text-sm text-black/60">Loading…</div>
            ) : !history || history.items.length === 0 ? (
              <div className="mt-3 text-sm text-black/60">No payments available</div>
            ) : (
              <>
                <div className="mt-3 hidden md:block min-w-0 overflow-x-auto">
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
                            {it.transaction.paid_at ? new Date(it.transaction.paid_at).toLocaleString() : "—"}
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
                          .catch((e) => toast.push("error", getErrorMessage(e)))
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
                          .catch((e) => toast.push("error", getErrorMessage(e)))
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
                      {detail.transaction?.created_at ? new Date(detail.transaction.created_at).toLocaleString() : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-black/55">Paid/confirmed at</div>
                    <div className="mt-0.5 text-xs font-semibold text-black/70">
                      {detail.transaction?.paid_at ? new Date(detail.transaction.paid_at).toLocaleString() : "—"}
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

              {detail.jobs?.length ? (
                <div>
                  <div className="text-xs font-semibold text-black/55">Linked jobs</div>
                  <ul className="mt-2 divide-y divide-black/10 rounded-2xl border border-black/10">
                    {detail.jobs.slice(0, 10).map((j) => (
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
                          setBusyId(detail.transaction.id);
                          void employeePaymentsApi
                            .uploadReceipt(detail.transaction.id, f)
                            .then(() => openDetail(detail.transaction.id))
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
                  {auth.role === "admin" ? (
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
                    isLoading={busyId === detail.transaction?.id}
                    onClick={() => {
                      const txId = detail.transaction?.id;
                      if (!txId) return;
                      const contractEmpId = detail.transaction?.contract_employee_id;
                      if (contractEmpId) {
                        setAllocOpen(true);
                        setAllocTxId(txId);
                        setAllocEmployeeId(contractEmpId);
                        setAllocEmployeeName(detail.employee_name);
                        setAllocAmount(String(detail.transaction?.amount ?? ""));
                        setOverpayConfirm(false);
                        setConfirmWithoutReceipt(auth.role === "admin" && !detail.transaction?.receipt_url);
                        setAllocLines({});
                        setAllocJobs([]);
                        setAllocLoading(true);
                        void contractEmployeesApi
                          .finances(contractEmpId)
                          .then((d) => setAllocJobs(Array.isArray(d?.jobs) ? d.jobs : []))
                          .catch((er) => toast.push("error", getErrorMessage(er)))
                          .finally(() => setAllocLoading(false));
                        return;
                      }
                      setConfirmTarget({ id: txId, kind: "monthly" });
                      setOverpayConfirm(false);
                      setConfirmWithoutReceipt(auth.role === "admin" && !detail.transaction?.receipt_url);
                    }}
                  >
                    Mark paid
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
              <div className="mt-0.5 font-bold">{new Date(pettyDetailFor.entry_date).toLocaleString()}</div>
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

      <Modal open={confirmTarget !== null} title="Confirm payment" onClose={() => (busyId ? null : setConfirmTarget(null))}>
        {confirmTarget ? (
          <div className="space-y-4">
            <div className="text-sm text-black/70">
              {confirmWithoutReceipt ? (
                <>Are you sure you want to proceed without a receipt?</>
              ) : (
                <>
                  Confirm marking this transaction as <span className="font-semibold">Paid</span>?
                </>
              )}
            </div>
            {overpayConfirm ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                <span className="font-semibold">Overpaid.</span> This payment will make the employee owe the company.
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
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
                    .then(() => Promise.all([refreshPending({ offset: pendingOffset }), refreshHistory({ offset: historyOffset })]))
                    .then(() => toast.push("success", "Marked paid."))
                    .then(() => setConfirmTarget(null))
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
                {overpayConfirm ? "Confirm overpay" : confirmWithoutReceipt ? "Yes" : "Confirm"}
              </Button>
              <Button
                variant="ghost"
                disabled={busyId === confirmTarget.id}
                onClick={() => {
                  setConfirmTarget(null);
                  setConfirmWithoutReceipt(false);
                  setOverpayConfirm(false);
                }}
              >
                {confirmWithoutReceipt ? "No" : "Cancel"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={allocOpen}
        title={allocEmployeeName ? `Allocate payment — ${allocEmployeeName}` : "Allocate payment"}
        onClose={() => (busyId || allocLoading ? null : setAllocOpen(false))}
      >
        <div className="space-y-4">
          <div className="text-sm text-black/70">
            Select one or more jobs and allocate amounts. Total allocations must equal the payment amount.
          </div>

          <label className="text-xs font-semibold text-black/60">
            Amount to pay (optional adjustment)
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={allocAmount}
              onChange={(e) => setAllocAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </label>

          {allocLoading ? (
            <div className="text-sm text-black/60">Loading jobs…</div>
          ) : activeAllocJobs.length === 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              No active jobs available for allocation
            </div>
          ) : (
            <>
              <div className="md:hidden space-y-3">
                {activeAllocJobs.map((j) => {
                  const v = allocLines[j.id] ?? "";
                  const checked = typeof allocLines[j.id] !== "undefined";
                  return (
                    <div
                      key={j.id}
                      className={[
                        "rounded-2xl border bg-white p-4",
                        checked ? "border-black/30 ring-2 ring-black/10" : "border-black/10"
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <label className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = { ...allocLines };
                              if (e.target.checked) next[j.id] = next[j.id] ?? "";
                              else delete next[j.id];
                              setAllocLines(next);
                            }}
                            className="mt-1 h-4 w-4"
                            aria-label={`Use job ${j.id}`}
                          />
                          <div>
                            <div className="text-sm font-bold">Job #{j.id}</div>
                            <div className="mt-0.5 text-xs font-semibold text-black/55">{j.status}</div>
                          </div>
                        </label>
                        <div className="text-right text-xs">
                          <div className="font-semibold text-black/55">Balance</div>
                          <div className="mt-0.5 text-sm font-bold tabular-nums">{formatMoney(j.balance ?? 0)}</div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                          <div className="font-semibold text-black/55">Total</div>
                          <div className="mt-0.5 font-bold tabular-nums">{formatMoney(j.final_price ?? 0)}</div>
                        </div>
                        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                          <div className="font-semibold text-black/55">Paid</div>
                          <div className="mt-0.5 font-bold tabular-nums">{formatMoney(j.amount_paid ?? 0)}</div>
                        </div>
                        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                          <div className="font-semibold text-black/55">Balance</div>
                          <div className="mt-0.5 font-bold tabular-nums">{formatMoney(j.balance ?? 0)}</div>
                        </div>
                      </div>

                      <label className="mt-3 block text-xs font-semibold text-black/60">
                        Allocate amount
                        <input
                          className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold text-right"
                          disabled={!checked}
                          value={v}
                          onChange={(e) => setAllocation(j.id, e.target.value, j.balance)}
                          inputMode="decimal"
                          placeholder="0"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block min-w-0 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-black/60">
                  <tr className="border-b border-black/10">
                    <th className="py-2 pr-3 font-semibold">Use</th>
                    <th className="py-2 pr-3 font-semibold">Job</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 text-right font-semibold">Total</th>
                    <th className="py-2 pr-3 text-right font-semibold">Paid</th>
                    <th className="py-2 pr-3 text-right font-semibold">Balance</th>
                    <th className="py-2 pr-0 text-right font-semibold">Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  {activeAllocJobs.map((j) => {
                    const v = allocLines[j.id] ?? "";
                    const checked = typeof allocLines[j.id] !== "undefined";
                    return (
                      <tr
                        key={j.id}
                        className={[
                          "border-b border-black/5",
                          checked ? "bg-black/[0.03]" : ""
                        ].join(" ")}
                      >
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = { ...allocLines };
                              if (e.target.checked) next[j.id] = next[j.id] ?? "";
                              else delete next[j.id];
                              setAllocLines(next);
                            }}
                          />
                        </td>
                        <td className="py-2 pr-3 font-semibold">#{j.id}</td>
                        <td className="py-2 pr-3 text-xs font-semibold text-black/60">{j.status}</td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatMoney(j.final_price ?? 0)}</td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatMoney(j.amount_paid ?? 0)}</td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatMoney(j.balance ?? 0)}</td>
                        <td className="py-2 pr-0 text-right">
                          <input
                            className="w-[140px] rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-right"
                            disabled={!checked}
                            value={v}
                            onChange={(e) => setAllocation(j.id, e.target.value, j.balance)}
                            inputMode="decimal"
                            placeholder="0"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              isLoading={busyId === allocTxId}
              disabled={!allocTxId || busyId === allocTxId || allocLoading}
              onClick={() => {
                if (!allocTxId) return;
                const entries = Object.entries(allocLines)
                  .map(([jobId, amt]) => ({ contract_job_id: Number(jobId), amount: amt }))
                  .filter((x) => x.contract_job_id > 0);
                const cleanedAllocations = entries
                  .map((x) => ({
                    contract_job_id: x.contract_job_id,
                    amount: String(x.amount ?? "").replaceAll(",", "").trim()
                  }))
                  .filter((x) => x.amount);
                setBusyId(allocTxId);
                void employeePaymentsApi
                  .markPaid(
                    allocTxId,
                    confirmWithoutReceipt || overpayConfirm
                      ? {
                          confirm_without_receipt: confirmWithoutReceipt ? true : undefined,
                          confirm_overpay: overpayConfirm ? true : undefined
                        }
                      : undefined,
                    {
                      amount_override: allocAmount?.trim() ? allocAmount.replaceAll(",", "").trim() : null,
                      allocations: cleanedAllocations
                    }
                  )
                  .then(() => Promise.all([refreshPending({ offset: pendingOffset }), refreshHistory({ offset: historyOffset })]))
                  .then(() => toast.push("success", "Marked paid."))
                  .then(() => setAllocOpen(false))
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
              Mark paid
            </Button>
            <Button variant="ghost" disabled={busyId === allocTxId || allocLoading} onClick={() => setAllocOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

