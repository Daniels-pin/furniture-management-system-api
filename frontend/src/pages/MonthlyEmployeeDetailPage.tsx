import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { employeesApi, type EmployeePeriodParams } from "../services/endpoints";
import { companyLocationsApi } from "../services/endpoints";
import { useCompanyLocations } from "../query/hooks";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import type {
  CompanyLocation,
  EmployeeAttendanceHistoryItem,
  EmployeeDetail,
  EmployeePayrollAdjustment,
  EmployeeTransaction,
  PayrollAdjustmentType
} from "../types/api";
import { formatLagosDateTime, formatLateAttendanceTime } from "../utils/datetime";
import { formatMoney } from "../utils/money";
import { AttendanceAdminTable } from "../components/employee/AttendanceAdminTable";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";
import {
  absenceDeductionAuto,
  absenceDeductionEffective,
  computePayrollPreview,
  earlySignOutDeductionAuto,
  earlySignOutDeductionEffective,
  latenessDeductionAuto,
  latenessDeductionEffective,
  sumAdjustmentsByType
} from "../utils/payroll";

function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  return Boolean(el.closest('a,button,input,select,textarea,label,[role="button"],[role="checkbox"]'));
}

type TransactionFormState = { amount: string; reason: string; notes: string };

function emptyTransactionForm(): TransactionFormState {
  return { amount: "", reason: "", notes: "" };
}

function emptyAttendanceOverrideFormState() {
  return {
    latenessDeductionTotal: "",
    absenceDeductionTotal: "",
    earlySignOutDeductionTotal: ""
  };
}

const ADJUSTMENT_TYPE_LABELS: Record<PayrollAdjustmentType, string> = {
  bonus: "Bonus",
  deduction: "Deduction",
  increment: "Increment"
};

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
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [txns, setTxns] = useState<EmployeeTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [att, setAtt] = useState<EmployeeAttendanceHistoryItem[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attHistoryExpanded, setAttHistoryExpanded] = useState(false);

  const companyLocsQuery = useCompanyLocations();
  const locs = companyLocsQuery.data ?? [];
  const locsLoading = companyLocsQuery.isLoading;
  const [workLocId, setWorkLocId] = useState<number | "none">("none");
  const [locSaving, setLocSaving] = useState(false);

  const [sendNote, setSendNote] = useState("");
  const [sending, setSending] = useState(false);

  const [baseSalary, setBaseSalary] = useState("");
  const [bonusForm, setBonusForm] = useState<TransactionFormState>(emptyTransactionForm);
  const [deductionForm, setDeductionForm] = useState<TransactionFormState>(emptyTransactionForm);
  const [incrementForm, setIncrementForm] = useState<TransactionFormState>(emptyTransactionForm);
  const [latenessDeductionTotal, setLatenessDeductionTotal] = useState("");
  const [absenceDeductionTotal, setAbsenceDeductionTotal] = useState("");
  const [earlySignOutDeductionTotal, setEarlySignOutDeductionTotal] = useState("");
  const [savingType, setSavingType] = useState<PayrollAdjustmentType | "attendance" | "base" | null>(null);
  const [editingAdj, setEditingAdj] = useState<EmployeePayrollAdjustment | null>(null);
  const [editForm, setEditForm] = useState<TransactionFormState>(emptyTransactionForm);
  const [adjPage, setAdjPage] = useState(0);
  const ADJ_PAGE_SIZE = 10;

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
    setDetail(null);
    setBonusForm(emptyTransactionForm());
    setDeductionForm(emptyTransactionForm());
    setIncrementForm(emptyTransactionForm());
    setLatenessDeductionTotal("");
    setAbsenceDeductionTotal("");
    setEarlySignOutDeductionTotal("");
    setSendNote("");
    setEditingAdj(null);
    setAdjPage(0);
    (async () => {
      setLoading(true);
      try {
        const d = await employeesApi.get(idNum, periodParams);
        if (!alive) return;
        setDetail(d);
        setWorkLocId(typeof d.work_location_id === "number" ? d.work_location_id : "none");

        const empBase = d.base_salary ?? null;
        setBaseSalary(empBase != null ? String(empBase) : "");
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

  async function saveWorkLocation() {
    if (!detail) return;
    if (auth.role !== "admin") {
      toast.push("error", "Only Admin can assign locations.");
      return;
    }
    setLocSaving(true);
    try {
      const next = await employeesApi.assignWorkLocation(
        detail.id,
        { location_id: workLocId === "none" ? null : workLocId },
        periodParams
      );
      setDetail(next);
      setWorkLocId(typeof next.work_location_id === "number" ? next.work_location_id : "none");
      toast.push("success", "Work location saved.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setLocSaving(false);
    }
  }

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

  const adjustments = detail?.payroll_adjustments ?? [];

  const computed = useMemo(() => {
    if (!detail) return null;
    const isAdmin = auth.role === "admin";
    const baseFromApi = Number(detail.base_salary ?? 0);
    const baseFromInput =
      isAdmin && baseSalary.trim() ? (parseMoneyInput(baseSalary) ?? baseFromApi) : baseFromApi;
    const bonusesTotal = sumAdjustmentsByType(adjustments, "bonus");
    const deductionsTotal = sumAdjustmentsByType(adjustments, "deduction");
    const incrementsTotal = sumAdjustmentsByType(adjustments, "increment");
    const latenessAuto = latenessDeductionAuto(detail.salary);
    const earlySignOutAuto = earlySignOutDeductionAuto(detail.salary);
    const absenceAuto = absenceDeductionAuto(detail.salary);
    const latenessSaved = latenessDeductionEffective(detail.salary);
    const earlySignOutSaved = earlySignOutDeductionEffective(detail.salary);
    const absenceSaved = absenceDeductionEffective(detail.salary);
    const latenessTotal = latenessDeductionTotal.trim()
      ? (parseMoneyInput(latenessDeductionTotal) ?? latenessSaved)
      : latenessSaved;
    const earlySignOutTotal = earlySignOutDeductionTotal.trim()
      ? (parseMoneyInput(earlySignOutDeductionTotal) ?? earlySignOutSaved)
      : earlySignOutSaved;
    const absenceTotal = absenceDeductionTotal.trim()
      ? (parseMoneyInput(absenceDeductionTotal) ?? absenceSaved)
      : absenceSaved;
    const preview = computePayrollPreview({
      baseSalary: baseFromInput,
      incrementsTotal,
      bonusesTotal,
      deductionsTotal,
      latenessDeduction: latenessTotal,
      earlySignOutDeduction: earlySignOutTotal,
      absenceDeduction: absenceTotal
    });
    const attendanceDeductions = latenessTotal + earlySignOutTotal + absenceTotal;
    return {
      baseSalary: baseFromInput,
      baseUsed: preview.baseUsed,
      bonusesTotal,
      deductionsTotal,
      incrementsTotal,
      latenessAuto,
      earlySignOutAuto,
      absenceAuto,
      latenessTotal,
      earlySignOutTotal,
      absenceTotal,
      attendanceDeductions,
      latenessAdjusted: latenessTotal !== latenessAuto,
      absenceAdjusted: absenceTotal !== absenceAuto,
      finalPayable: preview.finalPayable,
      totalDeductions: preview.totalDeductions
    };
  }, [
    adjustments,
    auth.role,
    detail,
    baseSalary,
    latenessDeductionTotal,
    earlySignOutDeductionTotal,
    absenceDeductionTotal
  ]);

  const pagedAdjustments = useMemo(() => {
    const start = adjPage * ADJ_PAGE_SIZE;
    return adjustments.slice(start, start + ADJ_PAGE_SIZE);
  }, [adjustments, adjPage]);

  const adjPageCount = Math.max(1, Math.ceil(adjustments.length / ADJ_PAGE_SIZE));

  function validateTransactionForm(form: TransactionFormState, label: string): number | null {
    if (!form.amount.trim()) {
      toast.push("error", `Enter a ${label} amount.`);
      return null;
    }
    if (!isValidThousandsCommaNumber(form.amount)) {
      toast.push("error", `Fix comma formatting in ${label} amount.`);
      return null;
    }
    const amount = parseMoneyInput(form.amount);
    if (amount === null || Number.isNaN(amount) || amount <= 0) {
      toast.push("error", `Enter a valid ${label} amount (> 0).`);
      return null;
    }
    if (!form.reason.trim()) {
      toast.push("error", `Enter a reason for this ${label.toLowerCase()}.`);
      return null;
    }
    return amount;
  }

  async function onSaveTransaction(type: PayrollAdjustmentType) {
    if (!detail) return;
    if (auth.role !== "admin") {
      toast.push("error", "Only Admin can add payroll adjustments.");
      return;
    }
    if (!detail.period.is_active) {
      toast.push("error", "Archived months are read-only.");
      return;
    }

    const form =
      type === "bonus" ? bonusForm : type === "deduction" ? deductionForm : incrementForm;
    const label = ADJUSTMENT_TYPE_LABELS[type];
    const amount = validateTransactionForm(form, label);
    if (amount === null) return;

    setSavingType(type);
    try {
      const updated = await runWithPaidConfirm((confirm) =>
        employeesApi.createPayrollAdjustment(
          detail.id,
          {
            adjustment_type: type,
            amount,
            reason: form.reason.trim(),
            notes: form.notes.trim() || null,
            confirm_financial_edit: confirm
          },
          { period_year: year, period_month: month }
        )
      );
      setDetail(updated);
      if (type === "bonus") setBonusForm(emptyTransactionForm());
      if (type === "deduction") setDeductionForm(emptyTransactionForm());
      if (type === "increment") setIncrementForm(emptyTransactionForm());
      toast.push("success", `${label} recorded.`);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSavingType(null);
    }
  }

  async function onSaveBaseSalary() {
    if (!detail) return;
    if (auth.role !== "admin") {
      toast.push("error", "Only Admin can update base salary.");
      return;
    }
    if (!baseSalary.trim()) {
      toast.push("error", "Enter a base salary.");
      return;
    }
    if (!isValidThousandsCommaNumber(baseSalary)) {
      toast.push("error", "Fix comma formatting in base salary.");
      return;
    }
    const desiredBase = parseMoneyInput(baseSalary);
    if (desiredBase === null || Number.isNaN(desiredBase) || desiredBase < 0) {
      toast.push("error", "Enter a valid base salary (≥ 0).");
      return;
    }
    const apiBase = Number(detail.base_salary ?? 0);
    if (desiredBase === apiBase) {
      toast.push("error", "Base salary is unchanged.");
      return;
    }

    setSavingType("base");
    try {
      const updated = await employeesApi.update(detail.id, { base_salary: desiredBase }, periodParams);
      setDetail(updated);
      setBaseSalary(String(updated.base_salary ?? desiredBase));
      toast.push("success", "Base salary saved.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSavingType(null);
    }
  }

  async function onSaveAttendanceOverrides() {
    if (!detail) return;
    if (auth.role !== "admin") {
      toast.push("error", "Only Admin can update attendance deductions.");
      return;
    }
    if (!detail.period.is_active) {
      toast.push("error", "Archived months are read-only.");
      return;
    }

    const latenessTotal = latenessDeductionTotal.trim() ? parseMoneyInput(latenessDeductionTotal) : undefined;
    const earlySignOutTotal = earlySignOutDeductionTotal.trim() ? parseMoneyInput(earlySignOutDeductionTotal) : undefined;
    const absenceTotal = absenceDeductionTotal.trim() ? parseMoneyInput(absenceDeductionTotal) : undefined;

    if (
      latenessTotal === undefined &&
      earlySignOutTotal === undefined &&
      absenceTotal === undefined
    ) {
      toast.push("error", "Enter at least one attendance deduction override.");
      return;
    }

    setSavingType("attendance");
    try {
      const updated = await runWithPaidConfirm((confirm) =>
        employeesApi.savePayrollAdjustments(
          detail.id,
          {
            confirm_financial_edit: confirm,
            ...(latenessTotal !== undefined ? { lateness_deduction: latenessTotal } : {}),
            ...(earlySignOutTotal !== undefined ? { early_sign_out_deduction: earlySignOutTotal } : {}),
            ...(absenceTotal !== undefined ? { absence_deduction: absenceTotal } : {})
          },
          { period_year: year, period_month: month }
        )
      );
      setDetail(updated);
      const cleared = emptyAttendanceOverrideFormState();
      setLatenessDeductionTotal(cleared.latenessDeductionTotal);
      setAbsenceDeductionTotal(cleared.absenceDeductionTotal);
      setEarlySignOutDeductionTotal(cleared.earlySignOutDeductionTotal);
      toast.push("success", "Attendance deductions saved.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSavingType(null);
    }
  }

  function startEditAdjustment(adj: EmployeePayrollAdjustment) {
    setEditingAdj(adj);
    setEditForm({
      amount: String(adj.amount),
      reason: adj.reason,
      notes: adj.notes ?? ""
    });
  }

  async function onSaveEditAdjustment() {
    if (!detail || !editingAdj) return;
    const amount = validateTransactionForm(editForm, ADJUSTMENT_TYPE_LABELS[editingAdj.adjustment_type]);
    if (amount === null) return;

    setSavingType(editingAdj.adjustment_type);
    try {
      const updated = await runWithPaidConfirm((confirm) =>
        employeesApi.updatePayrollAdjustment(
          detail.id,
          editingAdj.id,
          {
            amount,
            reason: editForm.reason.trim(),
            notes: editForm.notes.trim() || null,
            confirm_financial_edit: confirm
          },
          { period_year: year, period_month: month }
        )
      );
      setDetail(updated);
      setEditingAdj(null);
      setEditForm(emptyTransactionForm());
      toast.push("success", "Adjustment updated.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSavingType(null);
    }
  }

  async function onDeleteAdjustment(adj: EmployeePayrollAdjustment) {
    if (!detail) return;
    const ok = await askConfirm(
      "Delete adjustment",
      `Delete this ${ADJUSTMENT_TYPE_LABELS[adj.adjustment_type].toLowerCase()} of ${formatMoney(adj.amount)}?`
    );
    if (!ok) return;
    setSavingType(adj.adjustment_type);
    try {
      const updated = await runWithPaidConfirm((confirm) =>
        employeesApi.deletePayrollAdjustment(detail.id, adj.id, {
          period_year: year,
          period_month: month,
          confirm_financial_edit: confirm
        })
      );
      setDetail(updated);
      if (editingAdj?.id === adj.id) {
        setEditingAdj(null);
        setEditForm(emptyTransactionForm());
      }
      toast.push("success", "Adjustment deleted.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSavingType(null);
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
        <div className="text-xs font-semibold text-black/55">2b. Work location (Geo-attendance)</div>
        <p className="mt-1 text-xs text-black/55">Employees can only mark attendance within their assigned work location radius.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="text-xs font-semibold text-black/60">
            Assigned location
            <select
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              disabled={!isAdmin || locsLoading || locSaving}
              value={workLocId === "none" ? "none" : String(workLocId)}
              onChange={(e) => {
                const v = e.target.value;
                setWorkLocId(v === "none" ? "none" : Number(v));
              }}
            >
              <option value="none">None</option>
              {locs.map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.name} ({l.allowed_radius_meters}m · late {formatLateAttendanceTime(l.late_attendance_time)})
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" isLoading={locSaving} disabled={!isAdmin || locSaving} onClick={() => void saveWorkLocation()}>
            Save location
          </Button>
        </div>
        {detail.work_location ? (
          <div className="mt-2 text-xs font-semibold text-black/55">
            Current: {detail.work_location.name} · Radius {detail.work_location.allowed_radius_meters}m · Late after{" "}
            {formatLateAttendanceTime(detail.work_location.late_attendance_time)}
          </div>
        ) : (
          <div className="mt-2 text-xs font-semibold text-amber-900">No location assigned yet. Attendance marking will be blocked.</div>
        )}
      </Card>

      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">3. Attendance (Monthly employee)</div>
        <p className="mt-1 text-xs text-black/55">
          Deductions use fees configured on the assigned location (late coming, early sign-out, absence). Sundays are excluded.
          Assign a work location before attendance deductions apply to payroll.
        </p>
        {detail.salary.attendance_deductions_eligible === false ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
            No work location assigned — late and absence payroll deductions are not applied until a location is assigned.
          </p>
        ) : null}
        {attLoading ? (
          <div className="mt-2 text-sm text-black/60">Loading…</div>
        ) : att.length === 0 ? (
          <div className="mt-2 text-sm text-black/60">No attendance yet.</div>
        ) : (
          <div className="mt-3 min-w-0 overflow-x-auto">
            <p className="mb-2 text-xs font-semibold text-black/55">Latest record</p>
            <AttendanceAdminTable rows={att.slice(0, 1)} />
            {att.length > 1 ? (
              <>
                <button
                  type="button"
                  className="mt-3 text-xs font-semibold text-black/70 hover:text-black"
                  onClick={() => setAttHistoryExpanded((v) => !v)}
                >
                  {attHistoryExpanded ? "Hide history" : "View more history"}
                </button>
                {attHistoryExpanded ? (
                  <div className="mt-2">
                    <AttendanceAdminTable rows={att.slice(1)} />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </Card>

      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">4. Payroll adjustments</div>
        <p className="mt-1 text-xs text-black/55">
          Each bonus, deduction, and increment is saved as its own transaction. Archived months are read-only.
        </p>
        {!detail.period.is_active ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
            Viewing archived month {detail.period.label} — adjustments cannot be added or changed.
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label="Base salary — NGN"
            value={baseSalary}
            onChange={(e) => setBaseSalary(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 150,000"
            disabled={!isAdmin}
          />
          <div className="flex items-end">
            <Button
              variant="secondary"
              isLoading={savingType === "base"}
              disabled={!isAdmin || savingType !== null}
              onClick={() => void onSaveBaseSalary()}
            >
              Save base salary
            </Button>
          </div>
        </div>

        {(["bonus", "deduction", "increment"] as const).map((type) => {
          const form = type === "bonus" ? bonusForm : type === "deduction" ? deductionForm : incrementForm;
          const setForm =
            type === "bonus" ? setBonusForm : type === "deduction" ? setDeductionForm : setIncrementForm;
          const label = ADJUSTMENT_TYPE_LABELS[type];
          return (
            <div key={type} className="mt-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4">
              <div className="text-xs font-semibold text-black/60">Add {label}</div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input
                  label={`${label} amount — NGN`}
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  inputMode="decimal"
                  disabled={!isAdmin || !detail.period.is_active}
                />
                <Input
                  label="Reason"
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  disabled={!isAdmin || !detail.period.is_active}
                  placeholder={
                    type === "bonus"
                      ? "e.g. Excellent performance"
                      : type === "deduction"
                        ? "e.g. Uniform replacement"
                        : "e.g. Salary review"
                  }
                />
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-black/60">Notes (optional)</label>
                  <textarea
                    className="min-h-[72px] w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-black/40"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    disabled={!isAdmin || !detail.period.is_active}
                  />
                </div>
                <div className="md:col-span-2">
                  <Button
                    isLoading={savingType === type}
                    disabled={!isAdmin || !detail.period.is_active || savingType !== null}
                    onClick={() => void onSaveTransaction(type)}
                  >
                    Save {label}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}

        <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4">
          <div className="text-xs font-semibold text-black/60">Attendance deduction overrides</div>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Input
                label={`Lateness deduction (NGN) — ${detail.salary.lateness_count} record(s)`}
                value={latenessDeductionTotal}
                onChange={(e) => setLatenessDeductionTotal(e.target.value)}
                inputMode="decimal"
                disabled={!isAdmin || !detail.period.is_active}
              />
              {computed?.latenessAdjusted ? (
                <p className="mt-1 text-xs font-semibold text-amber-900">
                  Adjusted from calculated {formatMoney(computed.latenessAuto)}.
                </p>
              ) : (
                <p className="mt-1 text-xs text-black/55">Calculated: {formatMoney(computed?.latenessAuto ?? 0)}</p>
              )}
            </div>
            <div>
              <Input
                label={`Early sign-out deduction (NGN) — ${detail.salary.early_sign_out_count ?? 0} record(s)`}
                value={earlySignOutDeductionTotal}
                onChange={(e) => setEarlySignOutDeductionTotal(e.target.value)}
                inputMode="decimal"
                disabled={!isAdmin || !detail.period.is_active}
              />
              <p className="mt-1 text-xs text-black/55">Calculated: {formatMoney(computed?.earlySignOutAuto ?? 0)}</p>
            </div>
            <div>
              <Input
                label={`Absence deduction (NGN) — ${detail.salary.absence_count ?? 0} record(s)`}
                value={absenceDeductionTotal}
                onChange={(e) => setAbsenceDeductionTotal(e.target.value)}
                inputMode="decimal"
                disabled={!isAdmin || !detail.period.is_active}
              />
              {computed?.absenceAdjusted ? (
                <p className="mt-1 text-xs font-semibold text-amber-900">
                  Adjusted from calculated {formatMoney(computed.absenceAuto)}.
                </p>
              ) : (
                <p className="mt-1 text-xs text-black/55">Calculated: {formatMoney(computed?.absenceAuto ?? 0)}</p>
              )}
            </div>
            <div className="flex items-end">
              <Button
                variant="secondary"
                isLoading={savingType === "attendance"}
                disabled={!isAdmin || !detail.period.is_active || savingType !== null}
                onClick={() => void onSaveAttendanceOverrides()}
              >
                Save attendance overrides
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">4b. Adjustment history ({detail.period.label})</div>
        {adjustments.length === 0 ? (
          <div className="mt-2 text-sm text-black/60">No adjustments yet.</div>
        ) : (
          <>
            <div className="mt-3 min-w-0 overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="text-black/60">
                  <tr className="border-b border-black/10">
                    <th className="py-3 pr-4 font-semibold">Date</th>
                    <th className="py-3 pr-4 font-semibold">Type</th>
                    <th className="py-3 pr-4 text-right font-semibold">Amount</th>
                    <th className="py-3 pr-4 font-semibold">Reason</th>
                    <th className="py-3 pr-4 font-semibold">Added by</th>
                    {isAdmin && detail.period.is_active ? <th className="py-3 pr-0 font-semibold">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {pagedAdjustments.map((adj) => (
                    <tr key={adj.id} className="border-b border-black/5">
                      <td className="py-3 pr-4 text-xs font-semibold text-black/60">{formatLagosDateTime(adj.created_at)}</td>
                      <td className="py-3 pr-4 font-semibold">{ADJUSTMENT_TYPE_LABELS[adj.adjustment_type]}</td>
                      <td className="py-3 pr-4 text-right font-bold tabular-nums">{formatMoney(adj.amount)}</td>
                      <td className="py-3 pr-4 text-xs">{adj.reason}</td>
                      <td className="py-3 pr-4 text-xs text-black/60">{adj.created_by_name ?? "—"}</td>
                      {isAdmin && detail.period.is_active ? (
                        <td className="py-3 pr-0">
                          <div className="flex gap-2">
                            <Button variant="secondary" className="!min-h-8 !px-2 !py-1 !text-xs" onClick={() => startEditAdjustment(adj)}>
                              Edit
                            </Button>
                            <Button variant="danger" className="!min-h-8 !px-2 !py-1 !text-xs" onClick={() => void onDeleteAdjustment(adj)}>
                              Delete
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {adjustments.length > ADJ_PAGE_SIZE ? (
              <div className="mt-3 flex items-center justify-between text-xs font-semibold text-black/60">
                <span>
                  Page {adjPage + 1} of {adjPageCount}
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" className="!min-h-8" disabled={adjPage <= 0} onClick={() => setAdjPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    className="!min-h-8"
                    disabled={adjPage >= adjPageCount - 1}
                    onClick={() => setAdjPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}

        {editingAdj ? (
          <div className="mt-4 rounded-2xl border border-black/15 bg-white p-4">
            <div className="text-xs font-semibold text-black/60">
              Edit {ADJUSTMENT_TYPE_LABELS[editingAdj.adjustment_type]}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input
                label="Amount — NGN"
                value={editForm.amount}
                onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                inputMode="decimal"
              />
              <Input
                label="Reason"
                value={editForm.reason}
                onChange={(e) => setEditForm((f) => ({ ...f, reason: e.target.value }))}
              />
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-black/60">Notes (optional)</label>
                <textarea
                  className="min-h-[72px] w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
              <div className="md:col-span-2 flex gap-2">
                <Button isLoading={savingType === editingAdj.adjustment_type} onClick={() => void onSaveEditAdjustment()}>
                  Save changes
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingAdj(null);
                    setEditForm(emptyTransactionForm());
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">5. Final payable summary ({detail.period.label})</div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 text-sm">
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Base salary</div>
            <div className="mt-1 font-bold tabular-nums">{formatMoney(computed?.baseSalary ?? detail.salary.base_salary)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-sky-50/50 p-3">
            <div className="text-xs font-semibold text-sky-900/70">Increments</div>
            <div className="mt-1 font-bold tabular-nums text-sky-800">+{formatMoney(computed?.incrementsTotal ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Effective base</div>
            <div className="mt-1 font-bold tabular-nums">{formatMoney(computed?.baseUsed ?? detail.salary.base_salary_used)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-emerald-50/50 p-3">
            <div className="text-xs font-semibold text-emerald-900/70">Bonuses</div>
            <div className="mt-1 font-bold tabular-nums text-emerald-800">+{formatMoney(computed?.bonusesTotal ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-red-50/60 p-3">
            <div className="text-xs font-semibold text-red-900/70">Manual deductions</div>
            <div className="mt-1 font-bold tabular-nums text-red-800">−{formatMoney(computed?.deductionsTotal ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-amber-50/60 p-3">
            <div className="text-xs font-semibold text-amber-900/70">Attendance deductions</div>
            <div className="mt-1 font-bold tabular-nums text-amber-900">−{formatMoney(computed?.attendanceDeductions ?? 0)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Total deductions</div>
            <div className="mt-1 font-bold tabular-nums text-red-800">
              −{formatMoney(computed?.totalDeductions ?? detail.salary.total_deductions)}
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
        <div className="text-xs font-semibold text-black/55">6. Finance payment history ({detail.period.label})</div>
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
                    <td className="py-3 pr-4 text-xs font-semibold text-black/60">{formatLagosDateTime(t.created_at)}</td>
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

