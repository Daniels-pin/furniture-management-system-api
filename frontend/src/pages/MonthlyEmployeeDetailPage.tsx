import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { employeesApi, type EmployeePeriodParams } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import type { EmployeeAttendanceEntry, EmployeeDetail, EmployeeTransaction } from "../types/api";
import { formatMoney } from "../utils/money";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";

function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  return Boolean(el.closest('a,button,input,select,textarea,label,[role="button"],[role="checkbox"]'));
}

export function MonthlyEmployeeDetailPage() {
  const toast = useToast();
  const nav = useNavigate();
  const auth = useAuth();
  const { employeeId } = useParams();
  const [sp] = useSearchParams();
  const year = Number(sp.get("year")) || new Date().getFullYear();
  const month = Number(sp.get("month")) || new Date().getMonth() + 1;
  const periodParams = useMemo((): EmployeePeriodParams => ({ period_year: year, period_month: month }), [year, month]);

  const idNum = Number(employeeId);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [txns, setTxns] = useState<EmployeeTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [att, setAtt] = useState<EmployeeAttendanceEntry[]>([]);
  const [attLoading, setAttLoading] = useState(false);

  const [sendNote, setSendNote] = useState("");
  const [sending, setSending] = useState(false);

  const [baseSalary, setBaseSalary] = useState("");
  const [periodBaseSalary, setPeriodBaseSalary] = useState("");
  const [bonus, setBonus] = useState("");
  const [deduction, setDeduction] = useState("");
  // UI shows (attendance lateness deductions + manual adjustment), but we only save/apply the manual adjustment
  // to avoid double-deducting (lateness is already applied via salary.lateness_deduction).
  const [latePenaltyTotal, setLatePenaltyTotal] = useState("");
  const [adjNote, setAdjNote] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("Confirm");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmResolve, setConfirmResolve] = useState<null | ((v: boolean) => void)>(null);

  async function askConfirm(title: string, message: string) {
    return await new Promise<boolean>((resolve) => {
      setConfirmTitle(title);
      setConfirmMessage(message);
      setConfirmResolve(() => resolve);
      setConfirmOpen(true);
    });
  }

  async function runWithPaidConfirm<T>(fn: (confirmFinancialEdit: boolean) => Promise<T>): Promise<T> {
    try {
      return await fn(false);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        const ok = await askConfirm("Confirm change", "This month is marked paid. Change payroll records anyway?");
        if (ok) return await fn(true);
      }
      throw e;
    }
  }

  useEffect(() => {
    if (!Number.isFinite(idNum)) {
      setLoading(false);
      setDetail(null);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const d = await employeesApi.get(idNum, periodParams);
        if (!alive) return;
        setDetail(d);

        const empBase = d.base_salary ?? null;
        setBaseSalary(empBase != null ? String(empBase) : "");
        const baseOverride = d.salary.period_base_salary ?? null;
        setPeriodBaseSalary(baseOverride != null ? String(baseOverride) : "");
        setBonus(String(d.salary.adjustment_bonus ?? 0));
        setDeduction(String(d.salary.adjustment_deduction ?? 0));
        const latenessAuto = Number(d.salary.lateness_deduction ?? 0);
        const latePenaltyAdj = Number(d.salary.adjustment_late_penalty ?? 0);
        setLatePenaltyTotal(String(latenessAuto + latePenaltyAdj));
        // adjustment note is not currently returned in EmployeeDetail; keep local-only until refreshed via save.
        setAdjNote("");
      } catch (e) {
        toast.push("error", getErrorMessage(e));
        nav("/employees?tab=monthly");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [idNum, periodParams, nav, toast]);

  useEffect(() => {
    if (!Number.isFinite(idNum)) return;
    let alive = true;
    (async () => {
      setAttLoading(true);
      try {
        const rows = await employeesApi.attendance(idNum, { limit: 60, offset: 0 });
        if (!alive) return;
        setAtt(rows);
      } catch {
        // non-fatal
      } finally {
        if (alive) setAttLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [idNum]);

  useEffect(() => {
    if (!Number.isFinite(idNum)) return;
    let alive = true;
    (async () => {
      setTxLoading(true);
      try {
        const t = await employeesApi.transactions(idNum, periodParams);
        if (!alive) return;
        setTxns(t);
      } catch (e) {
        // non-fatal
      } finally {
        if (alive) setTxLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [idNum, periodParams]);

  const computed = useMemo(() => {
    if (!detail) return null;
    const isAdmin = auth.role === "admin";
    const baseFromApi = Number(detail.base_salary ?? 0);
    const baseFromInput =
      isAdmin && baseSalary.trim()
        ? (parseMoneyInput(baseSalary) ?? baseFromApi)
        : baseFromApi;
    const entriesBonus = Number(detail.salary.bonuses_entries_total ?? detail.salary.bonuses_total ?? 0);
    const entriesPen = Number(detail.salary.penalties_entries_total ?? detail.salary.penalties_total ?? 0);
    const lateness = Number(detail.salary.lateness_deduction ?? 0); // attendance-driven automatic deduction

    const baseOverride = periodBaseSalary.trim() ? parseMoneyInput(periodBaseSalary) : null;
    const b = parseMoneyInput(bonus) ?? 0;
    const d = parseMoneyInput(deduction) ?? 0;
    const lateTotal = parseMoneyInput(latePenaltyTotal) ?? 0;
    const lateAdj = Math.max(0, lateTotal - lateness);
    const baseUsed = baseOverride != null ? baseOverride : baseFromInput;
    const finalPayable = baseUsed + entriesBonus + b - (entriesPen + d + lateAdj) - lateness;
    return {
      baseUsed,
      entriesBonus,
      entriesPen,
      lateness,
      bonus: b,
      deduction: d,
      latePenaltyTotal: lateTotal,
      latePenaltyAdjustment: lateAdj,
      finalPayable
    };
  }, [auth.role, detail, baseSalary, periodBaseSalary, bonus, deduction, latePenaltyTotal]);

  async function onSaveAdjustments() {
    if (!detail) return;
    const isAdmin = auth.role === "admin";
    if (!isAdmin) {
      toast.push("error", "Only Admin can update payroll fields.");
      return;
    }

    if (baseSalary.trim() && !isValidThousandsCommaNumber(baseSalary)) {
      toast.push("error", "Fix comma formatting in base salary.");
      return;
    }
    if (periodBaseSalary.trim() && !isValidThousandsCommaNumber(periodBaseSalary)) {
      toast.push("error", "Fix comma formatting in base salary.");
      return;
    }
    if (bonus.trim() && !isValidThousandsCommaNumber(bonus)) {
      toast.push("error", "Fix comma formatting in bonus.");
      return;
    }
    if (deduction.trim() && !isValidThousandsCommaNumber(deduction)) {
      toast.push("error", "Fix comma formatting in deduction.");
      return;
    }
    if (latePenaltyTotal.trim() && !isValidThousandsCommaNumber(latePenaltyTotal)) {
      toast.push("error", "Fix comma formatting in late penalty.");
      return;
    }

    const empBase = baseSalary.trim() ? parseMoneyInput(baseSalary) : null;
    const baseOverride = periodBaseSalary.trim() ? parseMoneyInput(periodBaseSalary) : null;
    const b = bonus.trim() ? parseMoneyInput(bonus) : 0;
    const d = deduction.trim() ? parseMoneyInput(deduction) : 0;
    const latenessAuto = Number(detail.salary.lateness_deduction ?? 0);
    const lateTotal = latePenaltyTotal.trim() ? parseMoneyInput(latePenaltyTotal) : 0;
    const l = Math.max(0, (lateTotal ?? 0) - latenessAuto);
    if (empBase !== null && (Number.isNaN(empBase) || empBase < 0)) {
      toast.push("error", "Enter a valid base salary (≥ 0).");
      return;
    }
    if (baseOverride !== null && (Number.isNaN(baseOverride) || baseOverride < 0)) {
      toast.push("error", "Enter a valid base salary (≥ 0).");
      return;
    }
    if (b === null || Number.isNaN(b) || b < 0) {
      toast.push("error", "Enter a valid bonus (≥ 0).");
      return;
    }
    if (d === null || Number.isNaN(d) || d < 0) {
      toast.push("error", "Enter a valid deduction (≥ 0).");
      return;
    }
    if (l === null || Number.isNaN(l) || l < 0) {
      toast.push("error", "Enter a valid late penalty (≥ 0).");
      return;
    }

    setSaving(true);
    try {
      let next = detail;
      const apiBase = Number(detail.base_salary ?? 0);
      const desiredBase = empBase ?? apiBase;
      if (Number.isFinite(desiredBase) && desiredBase >= 0 && desiredBase !== apiBase) {
        next = await employeesApi.update(detail.id, { base_salary: desiredBase }, { period_year: year, period_month: month });
      }
      const updated = await runWithPaidConfirm((confirm) =>
        employeesApi.savePayrollAdjustments(
          next.id,
          {
            period_base_salary: baseOverride,
            bonus: b,
            deduction: d,
            late_penalty: l,
            note: adjNote.trim() || null,
            confirm_financial_edit: confirm
          },
          { period_year: year, period_month: month }
        )
      );
      setDetail(updated);
      setBaseSalary(String(updated.base_salary ?? desiredBase ?? ""));
      setBonus(String(updated.salary.adjustment_bonus ?? b ?? 0));
      setDeduction(String(updated.salary.adjustment_deduction ?? d ?? 0));
      const nextLatenessAuto = Number(updated.salary.lateness_deduction ?? 0);
      const nextLatePenaltyAdj = Number(updated.salary.adjustment_late_penalty ?? l ?? 0);
      setLatePenaltyTotal(String(nextLatenessAuto + nextLatePenaltyAdj));
      toast.push("success", "Saved adjustments.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function onSendToFinance() {
    if (!detail) return;
    setSending(true);
    try {
      const amount = computed?.finalPayable ?? Number(detail.salary.final_payable ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.push("error", "Final payable must be > 0 to send.");
        return;
      }
      await employeesApi.sendPaymentToFinance(
        detail.id,
        { amount, note: sendNote.trim() || null },
        { period_year: year, period_month: month }
      );
      const t = await employeesApi.transactions(detail.id, periodParams);
      setTxns(t);
      toast.push("success", "Sent to Finance.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSending(false);
    }
  }

  async function removeEmployee() {
    if (!detail) return;
    if (auth.role !== "admin") {
      toast.push("error", "Only Admin can remove employees.");
      return;
    }
    const ok = await askConfirm("Delete employee", `Delete employee “${detail.full_name}”? This cannot be undone.`);
    if (!ok) return;
    try {
      await employeesApi.remove(detail.id);
      toast.push("success", "Employee removed.");
      nav(`/employees?tab=monthly&year=${year}&month=${month}`);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  if (loading) {
    return (
      <Card>
        <div className="text-sm text-black/60">Loading…</div>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card>
        <div className="text-sm text-black/60">Not found.</div>
        <div className="mt-3">
          <Link className="text-sm font-semibold text-black underline decoration-black/30 underline-offset-2" to="/employees?tab=monthly">
            Back to employees
          </Link>
        </div>
      </Card>
    );
  }

  const backTo = `/employees?tab=monthly&year=${year}&month=${month}`;
  const isAdmin = auth.role === "admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <div className="truncate text-2xl font-bold tracking-tight">{detail.full_name}</div>
          <div className="mt-1 text-sm text-black/60">Monthly employee details and payroll.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => nav(backTo)}>
            Back
          </Button>
          {isAdmin ? (
            <Button variant="danger" onClick={() => void removeEmployee()}>
              Delete employee
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">1. Basic info</div>
        <div className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Name</div>
            <div className="mt-1 font-bold">{detail.full_name}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Phone</div>
            <div className="mt-1 font-bold">{detail.phone ?? "Not provided"}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3 sm:col-span-2 lg:col-span-1">
            <div className="text-xs font-semibold text-black/60">Address</div>
            <div className="mt-1 font-bold">{detail.address ?? "Not provided"}</div>
          </div>
        </div>
      </Card>

      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">2. Bank details</div>
        <div className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Bank name</div>
            <div className="mt-1 font-bold">{detail.bank_name ?? "Not provided"}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Account number</div>
            <div className="mt-1 font-mono text-xs font-bold">{detail.account_number ?? "Not provided"}</div>
          </div>
        </div>
      </Card>

      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">3. Attendance (Monthly employee)</div>
        <p className="mt-1 text-xs text-black/55">Mark attendance. Late coming attracts a ₦500 deduction.</p>
        {attLoading ? (
          <div className="mt-2 text-sm text-black/60">Loading…</div>
        ) : att.length === 0 ? (
          <div className="mt-2 text-sm text-black/60">No attendance yet.</div>
        ) : (
          <div className="mt-3 min-w-0 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-black/60">
                <tr className="border-b border-black/10">
                  <th className="py-3 pr-4 font-semibold">Date</th>
                  <th className="py-3 pr-4 font-semibold">Clock-in</th>
                  <th className="py-3 pr-4 font-semibold">Status</th>
                  <th className="py-3 pr-0 text-right font-semibold">Deduction</th>
                </tr>
              </thead>
              <tbody>
                {att.slice(0, 30).map((a) => (
                  <tr key={a.id} className="border-b border-black/5 hover:bg-black/[0.02]">
                    <td className="py-3 pr-4 font-semibold">{a.attendance_date}</td>
                    <td className="py-3 pr-4 text-xs font-semibold text-black/60">{new Date(a.check_in_at).toLocaleTimeString()}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          a.is_late ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"
                        ].join(" ")}
                      >
                        {a.is_late ? "Late" : "Present"}
                      </span>
                      {a.is_late && typeof a.late_minutes === "number" ? (
                        <span className="ml-2 text-xs font-semibold text-black/55">{a.late_minutes} min late</span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-0 text-right font-bold tabular-nums">{a.is_late ? "₦500" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">4. Payroll adjustment</div>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label="Base Salary — NGN"
            value={baseSalary}
            onChange={(e) => setBaseSalary(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 150,000"
            disabled={!isAdmin}
          />
          <Input
            label="Base salary (override for this month only) — NGN"
            value={periodBaseSalary}
            onChange={(e) => setPeriodBaseSalary(e.target.value)}
            inputMode="decimal"
            placeholder="Leave blank to use employee base salary"
            disabled={!isAdmin}
          />
          {!isAdmin ? (
            <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900">
              You don’t have permission to edit base salary.
            </div>
          ) : null}

          <Input
            label="Bonuses (NGN)"
            value={bonus}
            onChange={(e) => setBonus(e.target.value)}
            inputMode="decimal"
            disabled={!isAdmin}
          />
          <Input
            label="Deductions (NGN)"
            value={deduction}
            onChange={(e) => setDeduction(e.target.value)}
            inputMode="decimal"
            disabled={!isAdmin}
          />
          <Input
            label="Late penalties (NGN)"
            value={latePenaltyTotal}
            onChange={(e) => setLatePenaltyTotal(e.target.value)}
            inputMode="decimal"
            disabled={!isAdmin}
          />

          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-black/60">Notes (optional)</label>
            <textarea
              className="min-h-[88px] w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-black/40"
              value={adjNote}
              onChange={(e) => setAdjNote(e.target.value)}
              placeholder="Reason for adjustments…"
              disabled={!isAdmin}
            />
          </div>

          <div className="md:col-span-2 flex flex-wrap gap-2">
            <Button isLoading={saving} disabled={!isAdmin || saving} onClick={() => void onSaveAdjustments()}>
              Save Adjustments
            </Button>
            <Link
              to={`/employees/new`}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-black/5"
            >
              Add another employee
            </Link>
          </div>
        </div>
      </Card>

      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">5. Final payable summary ({detail.period.label})</div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 text-sm">
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Base</div>
            <div className="mt-1 font-bold tabular-nums">{formatMoney(computed?.baseUsed ?? detail.salary.base_salary)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-emerald-50/50 p-3">
            <div className="text-xs font-semibold text-emerald-900/70">Bonus</div>
            <div className="mt-1 font-bold tabular-nums text-emerald-800">+{formatMoney(computed?.bonus ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-red-50/60 p-3">
            <div className="text-xs font-semibold text-red-900/70">Deductions</div>
            <div className="mt-1 font-bold tabular-nums text-red-800">−{formatMoney(computed?.deduction ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-amber-50/60 p-3">
            <div className="text-xs font-semibold text-amber-900/70">Late penalties</div>
            <div className="mt-1 font-bold tabular-nums text-amber-900">−{formatMoney(computed?.latePenaltyTotal ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Existing payroll lines</div>
            <div className="mt-1 text-xs font-semibold text-black/55">
              Includes lateness, entry bonuses, and entry penalties (if any).
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-black bg-black px-4 py-3 text-white">
          <span className="text-sm font-bold">Final payable</span>
          <span className="text-lg font-bold tabular-nums">{formatMoney(computed?.finalPayable ?? detail.salary.final_payable)}</span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto] md:items-end">
          <label className="text-xs font-semibold text-black/60">
            Note to Finance (optional)
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={sendNote}
              onChange={(e) => setSendNote(e.target.value)}
              placeholder="e.g. April salary payment"
            />
          </label>
          <Button variant="secondary" isLoading={sending} disabled={!detail.period.is_active || sending} onClick={() => void onSendToFinance()}>
            Send to Finance
          </Button>
        </div>
        {!detail.period.is_active ? (
          <div className="mt-2 text-xs font-semibold text-amber-900">You’re viewing an archived month; you can’t send payments from here.</div>
        ) : null}
      </Card>

      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">6. Transaction history ({detail.period.label})</div>
        {txLoading ? (
          <div className="mt-2 text-sm text-black/60">Loading…</div>
        ) : txns.length === 0 ? (
          <div className="mt-2 text-sm text-black/60">No transactions yet.</div>
        ) : (
          <div className="mt-3 min-w-0 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-black/60">
                <tr className="border-b border-black/10">
                  <th className="py-3 pr-4 font-semibold">Date</th>
                  <th className="py-3 pr-4 font-semibold">Type</th>
                  <th className="py-3 pr-4 font-semibold">Status</th>
                  <th className="py-3 pr-4 text-right font-semibold">Amount</th>
                  <th className="py-3 pr-0 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-black/5 hover:bg-black/[0.02] cursor-default"
                    role="row"
                    tabIndex={-1}
                    onClick={(e) => {
                      if (isInteractiveTarget(e.target)) return;
                    }}
                  >
                    <td className="py-3 pr-4 text-xs font-semibold text-black/60">{new Date(t.created_at).toLocaleString()}</td>
                    <td className="py-3 pr-4 font-semibold">{t.txn_type}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          t.status === "paid"
                            ? "bg-emerald-100 text-emerald-900"
                            : t.status === "cancelled"
                              ? "bg-black/10 text-black/70"
                              : "bg-amber-100 text-amber-900"
                        ].join(" ")}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-right font-bold tabular-nums">{formatMoney(t.amount)}</td>
                    <td className="py-3 pr-0 text-xs text-black/60">{t.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmModal
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        busy={confirmBusy}
        confirmLabel="Yes"
        cancelLabel="No"
        confirmVariant="secondary"
        onClose={() => {
          if (confirmBusy) return;
          setConfirmOpen(false);
          const resolve = confirmResolve;
          setConfirmResolve(null);
          if (resolve) resolve(false);
        }}
        onConfirm={() => {
          if (confirmBusy) return;
          setConfirmBusy(true);
          const resolve = confirmResolve;
          setConfirmResolve(null);
          setConfirmOpen(false);
          setConfirmBusy(false);
          if (resolve) resolve(true);
        }}
      />
    </div>
  );
}

