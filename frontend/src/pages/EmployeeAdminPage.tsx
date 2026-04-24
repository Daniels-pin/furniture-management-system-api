import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { employeesApi, usersApi, type EmployeePeriodParams } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import type { EmployeeDetail, PayrollPeriodsNav, User } from "../types/api";
import { formatMoney } from "../utils/money";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";

async function runWithPaidConfirm<T>(fn: (confirmFinancialEdit: boolean) => Promise<T>): Promise<T> {
  try {
    return await fn(false);
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 409) {
      if (window.confirm("This month is marked paid. Change payroll records anyway?")) {
        return await fn(true);
      }
    }
    throw e;
  }
}

export function EmployeeAdminPage() {
  const auth = useAuth();
  const { employeeId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const year = Number(searchParams.get("year")) || new Date().getFullYear();
  const month = Number(searchParams.get("month")) || new Date().getMonth() + 1;
  const periodParams = useMemo((): EmployeePeriodParams => ({ period_year: year, period_month: month }), [year, month]);

  const isNew = employeeId === "new";
  const idNum = employeeId && !isNew ? Number(employeeId) : NaN;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [emp, setEmp] = useState<EmployeeDetail | null>(null);
  const [users, setUsers] = useState<User[]>([]);

  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [baseSalary, setBaseSalary] = useState("");
  const [userId, setUserId] = useState<string>("");
  const [loadedBaseSalary, setLoadedBaseSalary] = useState<string>("");

  const [latNote, setLatNote] = useState("");
  const [penDesc, setPenDesc] = useState("");
  const [penAmt, setPenAmt] = useState("");
  const [bonDesc, setBonDesc] = useState("");
  const [bonAmt, setBonAmt] = useState("");
  const [docLabel, setDocLabel] = useState("");
  const [docBusy, setDocBusy] = useState(false);

  const [payRef, setPayRef] = useState("");
  const [payDate, setPayDate] = useState("");
  const [periodNav, setPeriodNav] = useState<PayrollPeriodsNav | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const n = await employeesApi.payrollPeriodsNav();
        if (alive) setPeriodNav(n);
      } catch {
        // non-fatal; period dropdown falls back empty
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await usersApi.list();
        if (alive) setUsers(list);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Invalid month in URL → snap to active month from archive */
  useEffect(() => {
    if (!periodNav?.active_period || isNew) return;
    const valid = periodNav.periods.some((p) => p.year === year && p.month === month);
    if (!valid) {
      setSearchParams(
        { year: String(periodNav.active_period.year), month: String(periodNav.active_period.month) },
        { replace: true }
      );
    }
  }, [periodNav, year, month, isNew, setSearchParams]);

  useEffect(() => {
    if (isNew || !Number.isFinite(idNum)) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const d = await employeesApi.get(idNum, periodParams);
        if (!alive) return;
        applyDetail(d);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
        nav("/employees");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [employeeId, idNum, isNew, nav, toast, periodParams]);

  function applyDetail(d: EmployeeDetail) {
    setEmp(d);
    setFullName(d.full_name);
    setAddress(d.address ?? "");
    setPhone(d.phone ?? "");
    setAccountNumber(d.account_number ?? "");
    setNotes(d.notes ?? "");
    const bs = String(d.base_salary ?? "");
    setBaseSalary(bs);
    setLoadedBaseSalary(bs);
    setUserId(d.user_id != null ? String(d.user_id) : "");
    if (d.payment.payment_date) {
      const dt = new Date(d.payment.payment_date);
      setPayDate(dt.toISOString().slice(0, 10));
    } else {
      setPayDate(new Date().toISOString().slice(0, 10));
    }
    setPayRef(d.payment.payment_reference ?? "");
  }

  async function saveProfile() {
    if (!fullName.trim()) {
      toast.push("error", "Full name is required.");
      return;
    }
    const bs = parseMoneyInput(baseSalary);
    if (baseSalary.trim() && (bs === null || Number.isNaN(bs) || bs < 0)) {
      toast.push("error", "Enter a valid base salary (≥ 0).");
      return;
    }
    if (baseSalary.trim() && !isValidThousandsCommaNumber(baseSalary)) {
      toast.push("error", "Fix comma formatting in base salary.");
      return;
    }
    if (!isNew && loadedBaseSalary.trim() !== baseSalary.trim()) {
      if (!window.confirm("Update base salary? This affects payroll calculations for every month.")) {
        return;
      }
    }
    setSaving(true);
    try {
      if (isNew) {
        const created = await employeesApi.create({
          full_name: fullName.trim(),
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
          account_number: accountNumber.trim() || undefined,
          notes: notes.trim() || undefined,
          base_salary: bs !== null && !Number.isNaN(bs) ? bs : 0,
          user_id: userId ? Number(userId) : undefined
        });
        toast.push("success", "Employee created.");
        if (auth.role === "factory") {
          nav("/dashboard", { replace: true });
        } else {
          nav(`/employees/${created.id}?year=${year}&month=${month}`, { replace: true });
        }
        return;
      }
      if (!Number.isFinite(idNum)) return;
      const updated = await employeesApi.update(
        idNum,
        {
          full_name: fullName.trim(),
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
          account_number: accountNumber.trim() || undefined,
          notes: notes.trim() || undefined,
          base_salary: bs !== null && !Number.isNaN(bs) ? bs : undefined,
          user_id: userId ? Number(userId) : null
        },
        periodParams
      );
      applyDetail(updated);
      toast.push("success", "Saved.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function onAddLateness() {
    if (!emp || isNew) return;
    try {
      const d = await runWithPaidConfirm((confirm) =>
        employeesApi.addLateness(emp.id, { note: latNote.trim() || null, confirm_financial_edit: confirm }, periodParams)
      );
      applyDetail(d);
      setLatNote("");
      toast.push("success", "Lateness recorded.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  async function onAddPenalty() {
    if (!emp || isNew) return;
    const amt = parseMoneyInput(penAmt);
    if (!penDesc.trim() || penAmt.trim() === "" || amt === null || Number.isNaN(amt) || amt < 0) {
      toast.push("error", "Enter description and a valid penalty amount.");
      return;
    }
    try {
      const d = await runWithPaidConfirm((confirm) =>
        employeesApi.addPenalty(emp.id, { description: penDesc.trim(), amount: amt, confirm_financial_edit: confirm }, periodParams)
      );
      applyDetail(d);
      setPenDesc("");
      setPenAmt("");
      toast.push("success", "Penalty added.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  async function onAddBonus() {
    if (!emp || isNew) return;
    const amt = parseMoneyInput(bonAmt);
    if (!bonDesc.trim() || bonAmt.trim() === "" || amt === null || Number.isNaN(amt) || amt < 0) {
      toast.push("error", "Enter description and a valid bonus amount.");
      return;
    }
    try {
      const d = await runWithPaidConfirm((confirm) =>
        employeesApi.addBonus(emp.id, { description: bonDesc.trim(), amount: amt, confirm_financial_edit: confirm }, periodParams)
      );
      applyDetail(d);
      setBonDesc("");
      setBonAmt("");
      toast.push("success", "Bonus added.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  async function onUploadDoc(fileList: FileList | null) {
    if (!emp || isNew || !fileList?.length) return;
    const file = fileList[0];
    setDocBusy(true);
    try {
      const d = await employeesApi.uploadDocument(emp.id, file, docLabel.trim() || undefined, periodParams);
      applyDetail(d);
      setDocLabel("");
      toast.push("success", "Document uploaded.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setDocBusy(false);
    }
  }

  async function removeEmployee() {
    if (!emp || isNew) return;
    if (!window.confirm(`Delete employee “${emp.full_name}”? This cannot be undone.`)) return;
    try {
      await employeesApi.remove(emp.id);
      toast.push("success", "Employee removed.");
      nav("/employees");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  async function onPaymentAction(next: "paid" | "unpaid") {
    if (!emp || isNew) return;
    if (next === "paid") {
      if (!window.confirm(`Mark ${emp.period.label} as paid for ${emp.full_name}?`)) return;
    } else {
      if (!window.confirm(`Mark ${emp.period.label} as unpaid? Payment reference will be cleared.`)) return;
    }
    try {
      const iso = payDate ? new Date(payDate + "T12:00:00").toISOString() : undefined;
      const d = await employeesApi.updatePayment(
        emp.id,
        {
          payment_status: next,
          payment_date: next === "paid" ? iso : null,
          payment_reference: next === "paid" ? payRef.trim() || undefined : null
        },
        { period_year: year, period_month: month }
      );
      applyDetail(d);
      toast.push("success", next === "paid" ? "Marked paid." : "Marked unpaid.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  function setPeriod(nextYear: number, nextMonth: number) {
    const sp = new URLSearchParams(searchParams);
    sp.set("year", String(nextYear));
    sp.set("month", String(nextMonth));
    setSearchParams(sp);
  }

  if (loading) {
    return (
      <Card>
        <div className="text-sm text-black/60">Loading…</div>
      </Card>
    );
  }

  const salary = emp?.salary;
  const payrollReadOnly = Boolean(emp && !emp.period.is_active);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">{isNew ? "New employee" : emp?.full_name ?? "Employee"}</div>
          <div className="mt-1 text-sm text-black/60">
            <Link className="font-semibold underline decoration-black/30" to={`/employees?year=${year}&month=${month}`}>
              ← Employees
            </Link>
          </div>
        </div>
        {!isNew ? (
          <Button variant="danger" onClick={() => void removeEmployee()}>
            Delete employee
          </Button>
        ) : null}
      </div>

      {!isNew && emp ? (
        <Card>
          <div className="text-sm font-semibold text-black">Payroll month</div>
          <p className="mt-1 text-xs text-black/55">
            Only months in your payroll archive appear here. The active month is editable; older months are view-only for
            lateness, penalties, bonuses, and payment.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-black/60">
              Month
              <select
                className="ml-2 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-semibold"
                disabled={!periodNav?.periods.length}
                value={periodNav?.periods.some((p) => p.year === year && p.month === month) ? `${year}-${month}` : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const [ys, ms] = v.split("-");
                  setPeriod(Number(ys), Number(ms));
                }}
              >
                {!periodNav?.periods.length ? (
                  <option value="">Loading months…</option>
                ) : (
                  periodNav.periods.map((p) => (
                    <option key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
                      {p.label}
                      {p.is_active ? " (active)" : ""}
                    </option>
                  ))
                )}
              </select>
            </label>
            <span className="text-xs text-black/50">
              Showing: <span className="font-semibold text-black">{emp.period.label}</span>
              {payrollReadOnly ? (
                <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 font-semibold text-black/80">Archived</span>
              ) : (
                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-900">Active</span>
              )}
            </span>
          </div>
        </Card>
      ) : null}

      {!isNew && emp && payrollReadOnly ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span className="font-semibold">Archived month.</span> Payroll lines and payment status cannot be changed. Use{" "}
          <span className="font-semibold">Start new month</span> on the Employees list to work on the current period, or select
          the active month above if available.
        </div>
      ) : null}

      <Card>
        <div className="text-sm font-semibold text-black">Profile</div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div className="md:col-span-2">
            <Input label="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <Input label="Account number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
          <Input
            label="Base salary (NGN)"
            value={baseSalary}
            onChange={(e) => setBaseSalary(e.target.value)}
            inputMode="decimal"
            placeholder="0"
          />
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-black/60">Notes</label>
            <textarea
              className="min-h-[88px] w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-black/40"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-black/60">Linked app user (optional)</label>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-semibold"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">— None —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} ({u.role})
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs text-black/50">
              Linking lets this person open Employee Details to edit their own profile fields.
            </div>
          </div>
        </div>
        <div className="mt-6">
          <Button isLoading={saving} onClick={() => void saveProfile()}>
            {isNew ? "Create employee" : "Save profile"}
          </Button>
        </div>
      </Card>

      {!isNew && salary && emp ? (
        <Card>
          <div className="text-sm font-semibold text-black">Payslip — {emp.period.label}</div>
          <p className="mt-1 text-xs text-black/55">
            Review before payment or export. Net equals base minus lateness and penalties, plus bonuses. Total deductions
            include lateness and penalties.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Base</div>
              <div className="mt-1 font-bold tabular-nums">{formatMoney(salary.base_salary)}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Lateness ({salary.lateness_count}×)</div>
              <div className="mt-1 font-bold tabular-nums text-red-700">−{formatMoney(salary.lateness_deduction)}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Penalties</div>
              <div className="mt-1 font-bold tabular-nums text-red-700">−{formatMoney(salary.penalties_total)}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Bonuses</div>
              <div className="mt-1 font-bold tabular-nums text-emerald-800">+{formatMoney(salary.bonuses_total)}</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Total deductions</div>
              <div className="mt-1 font-bold tabular-nums text-red-800">−{formatMoney(salary.total_deductions)}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Payment status</div>
              <div className="mt-1 font-bold">
                {emp.payment.status === "paid" ? (
                  <span className="text-emerald-800">Paid</span>
                ) : (
                  <span className="text-amber-800">Unpaid</span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-2xl border border-black bg-black px-4 py-3 text-white">
            <span className="text-sm font-bold">Final payable</span>
            <span className="text-lg font-bold tabular-nums">{formatMoney(salary.final_payable)}</span>
          </div>
        </Card>
      ) : null}

      {!isNew && emp ? (
        <Card>
          <div className="text-sm font-semibold text-black">Payment status ({emp.period.label})</div>
          <p className="mt-1 text-xs text-black/55">
            Marking paid prevents accidental changes unless you confirm. Use a reference (e.g. bank transfer id) for your
            records.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input
              label="Payment date"
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              disabled={payrollReadOnly}
            />
            <div className="md:col-span-2">
              <Input
                label="Payment reference (optional)"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                disabled={payrollReadOnly}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void onPaymentAction("paid")}
              disabled={payrollReadOnly || emp.payment.status === "paid"}
            >
              Mark as paid
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void onPaymentAction("unpaid")}
              disabled={payrollReadOnly || emp.payment.status === "unpaid"}
            >
              Mark as unpaid
            </Button>
          </div>
        </Card>
      ) : null}

      {!isNew && emp ? (
        <Card>
          <div className="text-sm font-semibold text-black">Lateness</div>
          <p className="mt-1 text-xs text-black/55">Each entry deducts {formatMoney(salary?.lateness_rate_naira ?? 500)} from payroll.</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <Input label="Note (optional)" value={latNote} onChange={(e) => setLatNote(e.target.value)} disabled={payrollReadOnly} />
            </div>
            <Button type="button" variant="secondary" disabled={payrollReadOnly} onClick={() => void onAddLateness()}>
              Add lateness
            </Button>
          </div>
          <ul className="mt-4 divide-y divide-black/10 rounded-xl border border-black/10">
            {emp.lateness_entries.length === 0 ? (
              <li className="px-3 py-3 text-sm text-black/60">No lateness entries.</li>
            ) : (
              emp.lateness_entries.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="text-black/70">
                    {new Date(x.created_at).toLocaleString()}
                    {x.note ? ` — ${x.note}` : ""}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={payrollReadOnly}
                    onClick={async () => {
                      try {
                        const d = await runWithPaidConfirm((confirm) =>
                          employeesApi.deleteLateness(emp.id, x.id, { ...periodParams, confirm_financial_edit: confirm })
                        );
                        applyDetail(d);
                        toast.push("success", "Removed.");
                      } catch (e) {
                        toast.push("error", getErrorMessage(e));
                      }
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))
            )}
          </ul>
        </Card>
      ) : null}

      {!isNew && emp ? (
        <Card>
          <div className="text-sm font-semibold text-black">Penalties</div>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_120px_auto] md:items-end">
            <Input label="Description" value={penDesc} onChange={(e) => setPenDesc(e.target.value)} disabled={payrollReadOnly} />
            <Input
              label="Amount (NGN)"
              value={penAmt}
              onChange={(e) => setPenAmt(e.target.value)}
              inputMode="decimal"
              disabled={payrollReadOnly}
            />
            <Button type="button" variant="secondary" disabled={payrollReadOnly} onClick={() => void onAddPenalty()}>
              Add
            </Button>
          </div>
          <ul className="mt-4 divide-y divide-black/10 rounded-xl border border-black/10">
            {emp.penalties.length === 0 ? (
              <li className="px-3 py-3 text-sm text-black/60">No penalties.</li>
            ) : (
              emp.penalties.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold">{p.description}</span>{" "}
                    <span className="tabular-nums text-red-800">−{formatMoney(p.amount)}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={payrollReadOnly}
                    onClick={async () => {
                      try {
                        const d = await runWithPaidConfirm((confirm) =>
                          employeesApi.deletePenalty(emp.id, p.id, { ...periodParams, confirm_financial_edit: confirm })
                        );
                        applyDetail(d);
                        toast.push("success", "Removed.");
                      } catch (e) {
                        toast.push("error", getErrorMessage(e));
                      }
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))
            )}
          </ul>
        </Card>
      ) : null}

      {!isNew && emp ? (
        <Card>
          <div className="text-sm font-semibold text-black">Bonuses</div>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_120px_auto] md:items-end">
            <Input label="Description" value={bonDesc} onChange={(e) => setBonDesc(e.target.value)} disabled={payrollReadOnly} />
            <Input
              label="Amount (NGN)"
              value={bonAmt}
              onChange={(e) => setBonAmt(e.target.value)}
              inputMode="decimal"
              disabled={payrollReadOnly}
            />
            <Button type="button" variant="secondary" disabled={payrollReadOnly} onClick={() => void onAddBonus()}>
              Add
            </Button>
          </div>
          <ul className="mt-4 divide-y divide-black/10 rounded-xl border border-black/10">
            {emp.bonuses.length === 0 ? (
              <li className="px-3 py-3 text-sm text-black/60">No bonuses.</li>
            ) : (
              emp.bonuses.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold">{b.description}</span>{" "}
                    <span className="tabular-nums text-emerald-800">+{formatMoney(b.amount)}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={payrollReadOnly}
                    onClick={async () => {
                      try {
                        const d = await runWithPaidConfirm((confirm) =>
                          employeesApi.deleteBonus(emp.id, b.id, { ...periodParams, confirm_financial_edit: confirm })
                        );
                        applyDetail(d);
                        toast.push("success", "Removed.");
                      } catch (e) {
                        toast.push("error", getErrorMessage(e));
                      }
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))
            )}
          </ul>
        </Card>
      ) : null}

      {!isNew && emp ? (
        <Card>
          <div className="text-sm font-semibold text-black">Documents</div>
          <p className="mt-1 text-xs text-black/55">PDFs and files are stored on Cloudinary (URL).</p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto] md:items-end">
            <Input label="Label (optional)" value={docLabel} onChange={(e) => setDocLabel(e.target.value)} />
            <div>
              <label className="mb-1 block text-xs font-semibold text-black/60">Upload</label>
              <input
                type="file"
                className="block w-full text-sm"
                disabled={docBusy}
                onChange={(e) => void onUploadDoc(e.target.files)}
              />
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            {(emp.documents ?? []).length === 0 ? (
              <li className="text-sm text-black/60">No documents.</li>
            ) : (
              (emp.documents ?? []).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm">
                  <a className="font-semibold underline decoration-black/30" href={d.url} target="_blank" rel="noreferrer">
                    {d.label || "Document"}
                  </a>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        const out = await employeesApi.deleteDocument(emp.id, d.id, periodParams);
                        applyDetail(out);
                        toast.push("success", "Document removed.");
                      } catch (e) {
                        toast.push("error", getErrorMessage(e));
                      }
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))
            )}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
