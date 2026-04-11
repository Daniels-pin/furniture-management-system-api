import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  InventoryFinancialSummary,
  InventoryMaterial,
  InventoryMovement,
  InventoryMovementAction,
  InventoryPayment,
  InventoryPaymentStatus,
  InventoryStockLevel,
  InventorySupplierFinancialRow,
  InventoryTrackingMode
} from "../types/api";
import { inventoryApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { formatMoney } from "../utils/money";
import { isValidThousandsCommaNumber, sanitizeMoneyInput } from "../utils/moneyInput";

function fmtNum(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function fmtWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function toLocalDatetimeValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function stockLevelBadge(level: InventoryStockLevel) {
  const cls =
    level === "low"
      ? "bg-amber-100 text-amber-950 ring-amber-700/20"
      : level === "medium"
        ? "bg-sky-100 text-sky-950 ring-sky-700/20"
        : "bg-emerald-100 text-emerald-950 ring-emerald-700/20";
  return (
    <span className={["inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset", cls].join(" ")}>
      {level === "low" ? "Low" : level === "medium" ? "Medium" : "Full"}
    </span>
  );
}

const PAYMENT_OPTS: InventoryPaymentStatus[] = ["unpaid", "partial", "paid"];

export function InventoryPage() {
  const toast = useToast();
  const auth = useAuth();
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<string[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<string[]>([]);
  const [rows, setRows] = useState<InventoryMaterial[]>([]);
  const [search, setSearch] = useState("");
  const [fStock, setFStock] = useState<"" | InventoryStockLevel>("");
  const [fSupplier, setFSupplier] = useState("");
  const [fPayment, setFPayment] = useState<"" | InventoryPaymentStatus>("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [moveOpen, setMoveOpen] = useState(false);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveFilterId, setMoveFilterId] = useState<number | "">("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryMaterial | null>(null);
  const [saving, setSaving] = useState(false);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustRow, setAdjustRow] = useState<InventoryMaterial | null>(null);
  const [adjAction, setAdjAction] = useState<InventoryMovementAction>("adjusted");
  const [adjDelta, setAdjDelta] = useState("");

  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkStock, setBulkStock] = useState<InventoryStockLevel>("medium");
  const [bulkSupplier, setBulkSupplier] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");

  const [financialSummary, setFinancialSummary] = useState<InventoryFinancialSummary | null>(null);
  const [supplierFin, setSupplierFin] = useState<InventorySupplierFinancialRow[]>([]);

  const [payOpen, setPayOpen] = useState(false);
  const [payRow, setPayRow] = useState<InventoryMaterial | null>(null);
  const [payList, setPayList] = useState<InventoryPayment[]>([]);
  const [payLoading, setPayLoading] = useState(false);
  const [paySaving, setPaySaving] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState("");
  const [payNote, setPayNote] = useState("");

  const [form, setForm] = useState({
    material_name: "",
    category: "",
    tracking_mode: "numeric" as InventoryTrackingMode,
    quantity: "",
    unit: "kg",
    stock_level: "medium" as InventoryStockLevel,
    supplier_name: "",
    cost: "",
    notes: ""
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sup] = await Promise.all([
        inventoryApi.list({
          search: search.trim() || undefined,
          stock_level: fStock || undefined,
          supplier: fSupplier.trim() || undefined,
          payment_status: fPayment || undefined
        }),
        inventoryApi.suppliers().catch(() => ({ suppliers: [] as string[] }))
      ]);
      setRows(Array.isArray(list) ? list : []);
      setSupplierOptions(Array.isArray(sup.suppliers) ? sup.suppliers : []);
      if (auth.role === "admin") {
        try {
          const [summ, supf] = await Promise.all([
            inventoryApi.financialSummary(),
            inventoryApi.supplierFinancials()
          ]);
          setFinancialSummary(summ);
          setSupplierFin(Array.isArray(supf) ? supf : []);
        } catch {
          setFinancialSummary(null);
          setSupplierFin([]);
        }
      } else {
        setFinancialSummary(null);
        setSupplierFin([]);
      }
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [search, fStock, fSupplier, fPayment, toast, auth.role]);

  useEffect(() => {
    void (async () => {
      try {
        const u = await inventoryApi.units();
        setUnits(Array.isArray(u.units) ? u.units : []);
      } catch {
        setUnits([]);
      }
    })();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 300);
    return () => window.clearTimeout(t);
  }, [refresh]);

  useEffect(() => {
    if (!payOpen) return;
    setPayRow((prev) => {
      if (!prev) return prev;
      const u = rows.find((r) => r.id === prev.id);
      return u ?? prev;
    });
  }, [rows, payOpen]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }
  function toggleOne(id: number) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function openCreate() {
    setEditing(null);
    setForm({
      material_name: "",
      category: "",
      tracking_mode: "numeric",
      quantity: "0",
      unit: units[0] ?? "kg",
      stock_level: "medium",
      supplier_name: "",
      cost: "",
      notes: ""
    });
    setFormOpen(true);
  }

  function openEdit(r: InventoryMaterial) {
    setEditing(r);
    setForm({
      material_name: r.material_name,
      category: r.category ?? "",
      tracking_mode: r.tracking_mode,
      quantity:
        r.tracking_mode === "numeric" && r.quantity !== null && r.quantity !== undefined
          ? String(r.quantity)
          : "",
      unit: r.unit,
      stock_level: r.stock_level,
      supplier_name: r.supplier_name ?? "",
      cost: r.cost !== null && r.cost !== undefined ? String(r.cost) : "",
      notes: r.notes ?? ""
    });
    setFormOpen(true);
  }

  async function saveForm() {
    setSaving(true);
    try {
      const base: Record<string, unknown> = {
        material_name: form.material_name.trim(),
        category: form.category.trim() || null,
        tracking_mode: form.tracking_mode,
        unit: form.unit,
        stock_level: form.stock_level,
        supplier_name: form.supplier_name.trim(),
        cost: form.cost.trim() ? sanitizeMoneyInput(form.cost.trim()) : null,
        notes: form.notes.trim() || null
      };
      if (form.tracking_mode === "numeric") {
        base.quantity = form.quantity.trim() ? form.quantity.trim() : "0";
      }

      if (editing) {
        await inventoryApi.update(editing.id, base);
        toast.push("success", "Material updated");
      } else {
        await inventoryApi.create(base);
        toast.push("success", "Material added");
      }
      setFormOpen(false);
      await refresh();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function loadMovements() {
    setMoveLoading(true);
    try {
      const data = await inventoryApi.movements({
        material_id: moveFilterId === "" ? undefined : moveFilterId,
        limit: 200
      });
      setMovements(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setMoveLoading(false);
    }
  }

  useEffect(() => {
    if (!moveOpen) return;
    void loadMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveOpen, moveFilterId]);

  async function openPayments(r: InventoryMaterial) {
    setPayRow(r);
    setPayOpen(true);
    setPayAmount("");
    setPayNote("");
    setPayDate(toLocalDatetimeValue(new Date()));
    setPayLoading(true);
    try {
      const list = await inventoryApi.listPayments(r.id);
      setPayList(Array.isArray(list) ? list : []);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
      setPayList([]);
    } finally {
      setPayLoading(false);
    }
  }

  async function submitPayment() {
    if (!payRow) return;
    const raw = payAmount.trim();
    if (!raw) {
      toast.push("error", "Enter payment amount");
      return;
    }
    if (!isValidThousandsCommaNumber(raw)) {
      toast.push("error", "Fix comma formatting (e.g. 1,000).");
      return;
    }
    if (!payDate.trim()) {
      toast.push("error", "Choose payment date");
      return;
    }
    setPaySaving(true);
    try {
      const paid_at = new Date(payDate).toISOString();
      await inventoryApi.addPayment(payRow.id, {
        amount: sanitizeMoneyInput(raw),
        paid_at,
        note: payNote.trim() || null
      });
      toast.push("success", "Payment recorded");
      setPayAmount("");
      setPayNote("");
      const list = await inventoryApi.listPayments(payRow.id);
      setPayList(Array.isArray(list) ? list : []);
      await refresh();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setPaySaving(false);
    }
  }

  async function removePayment(paymentId: number) {
    if (!payRow) return;
    if (!window.confirm("Remove this payment entry?")) return;
    try {
      await inventoryApi.deletePayment(payRow.id, paymentId);
      toast.push("success", "Payment removed");
      const list = await inventoryApi.listPayments(payRow.id);
      setPayList(Array.isArray(list) ? list : []);
      await refresh();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  async function doDelete(r: InventoryMaterial) {
    if (!window.confirm(`Move “${r.material_name}” to Trash?`)) return;
    try {
      await inventoryApi.remove(r.id);
      toast.push("success", "Moved to Trash");
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(r.id);
        return n;
      });
      await refresh();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Move ${ids.length} material(s) to Trash?`)) return;
    try {
      await inventoryApi.bulkDelete(ids);
      toast.push("success", "Moved to Trash");
      setSelected(new Set());
      await refresh();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  async function bulkSetStock() {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      await inventoryApi.bulkStockLevel(ids, bulkStock);
      toast.push("success", "Stock level updated");
      setSelected(new Set());
      await refresh();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  async function saveBulkEdit() {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      await inventoryApi.bulkUpdate(ids, {
        stock_level: bulkStock,
        ...(bulkSupplier.trim() ? { supplier_name: bulkSupplier.trim() } : {}),
        ...(bulkCategory.trim() ? { category: bulkCategory.trim() } : { category: null })
      });
      toast.push("success", "Bulk update applied");
      setBulkEditOpen(false);
      setSelected(new Set());
      await refresh();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  function openAdjust(r: InventoryMaterial) {
    setAdjustRow(r);
    setAdjAction("adjusted");
    setAdjDelta("");
    setAdjustOpen(true);
  }

  async function submitAdjust() {
    if (!adjustRow) return;
    const raw = adjDelta.trim();
    if (!raw) {
      toast.push("error", "Enter a quantity change");
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      toast.push("error", "Invalid number");
      return;
    }
    try {
      const quantity_delta =
        adjAction === "used" ? -Math.abs(n) : adjAction === "added" ? Math.abs(n) : n;
      await inventoryApi.postMovement(adjustRow.id, {
        action: adjAction,
        quantity_delta
      });
      toast.push("success", "Stock updated");
      setAdjustOpen(false);
      await refresh();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  const selectedCount = selected.size;
  const moveMaterialOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rows) m.set(r.id, r.material_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Inventory</div>
          <div className="mt-1 text-sm text-black/60">
            Factory materials, stock levels, suppliers, and movement history (separate from sales products).
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setMoveOpen(true)}>
            Stock movements
          </Button>
          <Button onClick={openCreate}>Add material</Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Input label="Search" placeholder="Name, supplier, category…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="block">
            <div className="mb-1 text-sm font-medium">Stock level</div>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm"
              value={fStock}
              onChange={(e) => setFStock(e.target.value as typeof fStock)}
            >
              <option value="">All</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="full">Full</option>
            </select>
          </label>
          <label className="block">
            <div className="mb-1 text-sm font-medium">Supplier</div>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm"
              value={fSupplier}
              onChange={(e) => setFSupplier(e.target.value)}
            >
              <option value="">All</option>
              {supplierOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="mb-1 text-sm font-medium">Payment</div>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm"
              value={fPayment}
              onChange={(e) => setFPayment(e.target.value as typeof fPayment)}
            >
              <option value="">All</option>
              {PAYMENT_OPTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {auth.role === "admin" && financialSummary ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <div className="text-sm font-semibold text-black/70">Inventory financial summary</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-xs font-medium text-black/50">Total cost</div>
                <div className="text-lg font-bold tabular-nums">{formatMoney(financialSummary.total_cost)}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-black/50">Total paid</div>
                <div className="text-lg font-bold tabular-nums">{formatMoney(financialSummary.total_paid)}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-black/50">Outstanding</div>
                <div className="text-lg font-bold tabular-nums">{formatMoney(financialSummary.total_outstanding)}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-black/45">{financialSummary.material_count} active material(s)</div>
          </Card>
          <Card className="min-w-0 overflow-x-touch p-0">
            <div className="border-b border-black/10 px-4 py-3 text-sm font-semibold text-black/70">By supplier</div>
            {supplierFin.length === 0 ? (
              <div className="p-4 text-sm text-black/50">No supplier cost data yet.</div>
            ) : (
              <table className="w-full min-w-[420px] border-collapse text-left text-sm">
                <thead className="text-black/55">
                  <tr className="border-b border-black/10">
                    <th className="px-4 py-2 font-semibold">Supplier</th>
                    <th className="px-4 py-2 font-semibold">Cost</th>
                    <th className="px-4 py-2 font-semibold">Paid</th>
                    <th className="px-4 py-2 font-semibold">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierFin.map((s) => (
                    <tr key={s.supplier_name} className="border-b border-black/5">
                      <td className="px-4 py-2 font-medium">{s.supplier_name}</td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(s.total_cost)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(s.total_paid)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(s.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      ) : null}

      {selectedCount > 0 ? (
        <Card className="flex flex-col gap-3 p-4 md:flex-row md:flex-wrap md:items-center">
          <div className="text-sm font-semibold">{selectedCount} selected</div>
          <Button variant="secondary" onClick={() => void bulkDelete()}>
            Bulk delete
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
              value={bulkStock}
              onChange={(e) => setBulkStock(e.target.value as InventoryStockLevel)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="full">Full</option>
            </select>
            <Button variant="secondary" onClick={() => void bulkSetStock()}>
              Set stock level
            </Button>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              const first = rows.find((r) => selected.has(r.id));
              if (first) {
                setBulkStock(first.stock_level);
                setBulkSupplier(first.supplier_name ?? "");
                setBulkCategory(first.category ?? "");
              }
              setBulkEditOpen(true);
            }}
          >
            Bulk edit…
          </Button>
          <button type="button" className="text-sm font-semibold text-black/60 hover:text-black" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </Card>
      ) : null}

      <Card className="min-w-0 overflow-x-touch p-0">
        {loading ? (
          <div className="p-6 text-sm text-black/60">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-black/60">No materials match your filters.</div>
        ) : (
          <table className="min-w-[1180px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-black/[0.02]">
                <th className="px-3 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th className="px-3 py-3 font-semibold">Material</th>
                <th className="px-3 py-3 font-semibold">Category</th>
                <th className="px-3 py-3 font-semibold">Tracking</th>
                <th className="px-3 py-3 font-semibold">Qty</th>
                <th className="px-3 py-3 font-semibold">Stock</th>
                <th className="px-3 py-3 font-semibold">Supplier</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Cost</th>
                <th className="px-3 py-3 font-semibold">Paid</th>
                <th className="px-3 py-3 font-semibold">Balance</th>
                <th className="px-3 py-3 font-semibold">Added by</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const low = r.stock_level === "low";
                return (
                  <tr
                    key={r.id}
                    className={[
                      "border-b border-black/5",
                      low ? "bg-amber-50/80 border-l-4 border-l-amber-500" : ""
                    ].join(" ")}
                  >
                    <td className="px-3 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleOne(r.id)}
                        aria-label={`Select ${r.material_name}`}
                      />
                    </td>
                    <td className="px-3 py-3 align-top font-semibold">
                      <Link className="text-black hover:underline" to={`/inventory/${r.id}`}>
                        {r.material_name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 align-top text-black/70">{r.category || "—"}</td>
                    <td className="px-3 py-3 align-top text-black/70">{r.tracking_mode === "numeric" ? "Numeric" : "Status"}</td>
                    <td className="px-3 py-3 align-top tabular-nums">
                      {r.tracking_mode === "numeric" ? fmtNum(r.quantity) : "—"} {r.tracking_mode === "numeric" ? r.unit : ""}
                    </td>
                    <td className="px-3 py-3 align-top">{stockLevelBadge(r.stock_level)}</td>
                    <td className="px-3 py-3 align-top">{r.supplier_name || "—"}</td>
                    <td className="px-3 py-3 align-top capitalize">{r.payment_status}</td>
                    <td className="px-3 py-3 align-top tabular-nums">{formatMoney(r.cost)}</td>
                    <td className="px-3 py-3 align-top tabular-nums">{formatMoney(r.amount_paid)}</td>
                    <td className="px-3 py-3 align-top tabular-nums">
                      {r.balance === null || r.balance === undefined ? "—" : formatMoney(r.balance)}
                    </td>
                    <td className="px-3 py-3 align-top text-black/60">{r.added_by || "—"}</td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        <Link className="text-xs font-bold text-black/70 hover:underline" to={`/inventory/${r.id}`}>
                          View
                        </Link>
                        <button type="button" className="text-xs font-bold text-black/70 hover:underline" onClick={() => openEdit(r)}>
                          Edit
                        </button>
                        <button type="button" className="text-xs font-bold text-black/70 hover:underline" onClick={() => void openPayments(r)}>
                          Payments
                        </button>
                        {r.tracking_mode === "numeric" ? (
                          <button type="button" className="text-xs font-bold text-black/70 hover:underline" onClick={() => openAdjust(r)}>
                            Stock Δ
                          </button>
                        ) : null}
                        <button type="button" className="text-xs font-bold text-red-700 hover:underline" onClick={() => void doDelete(r)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={formOpen} title={editing ? "Edit material" : "Add material"} onClose={() => setFormOpen(false)}>
        <div className="space-y-3 px-6 pb-6">
          <Input label="Material name" value={form.material_name} onChange={(e) => setForm((f) => ({ ...f, material_name: e.target.value }))} />
          <Input label="Category (optional)" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
          <label className="block">
            <div className="mb-1 text-sm font-medium">Tracking</div>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
              value={form.tracking_mode}
              onChange={(e) => setForm((f) => ({ ...f, tracking_mode: e.target.value as InventoryTrackingMode }))}
            >
              <option value="numeric">Numeric (measurable quantity)</option>
              <option value="status_only">Status only (manual Low / Medium / Full)</option>
            </select>
            <div className="mt-1 text-xs text-black/50">Stock level is always set manually — it is not calculated from quantity.</div>
          </label>
          {form.tracking_mode === "numeric" ? (
            <Input
              label="Quantity"
              type="text"
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            />
          ) : null}
          <label className="block">
            <div className="mb-1 text-sm font-medium">Unit</div>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
              value={form.unit}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
            >
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="mb-1 text-sm font-medium">Stock level</div>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
              value={form.stock_level}
              onChange={(e) => setForm((f) => ({ ...f, stock_level: e.target.value as InventoryStockLevel }))}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="full">Full</option>
            </select>
          </label>
          <Input label="Supplier" value={form.supplier_name} onChange={(e) => setForm((f) => ({ ...f, supplier_name: e.target.value }))} />
          <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-black/55">
            Payment status is calculated from recorded payments vs. cost. Use <span className="font-semibold text-black/70">Payments</span> on
            each row to log supplier payments.
          </div>
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 px-3 py-2 text-xs text-amber-950">
            Extra stock from a <span className="font-semibold">new purchase</span> should be logged on the material&apos;s{" "}
            <span className="font-semibold">View</span> page (&quot;Log new purchase&quot;) so totals and history stay cumulative—avoid editing
            quantity here for that case.
          </div>
          <Input
            label="Cost"
            type="text"
            inputMode="decimal"
            value={form.cost}
            onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
            error={form.cost.trim() && !isValidThousandsCommaNumber(form.cost) ? "Invalid comma formatting" : undefined}
          />
          <label className="block">
            <div className="mb-1 text-sm font-medium">Notes</div>
            <textarea
              className="min-h-[88px] w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving || !form.material_name.trim()} onClick={() => void saveForm()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={moveOpen} title="Stock movement log" onClose={() => setMoveOpen(false)}>
        <div className="space-y-3 px-6 pb-6">
          <label className="block">
            <div className="mb-1 text-sm font-medium">Material filter</div>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
              value={moveFilterId === "" ? "" : String(moveFilterId)}
              onChange={(e) => setMoveFilterId(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">All materials</option>
              {moveMaterialOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" onClick={() => void loadMovements()}>
            Refresh
          </Button>
          <div className="max-h-[420px] overflow-auto rounded-2xl border border-black/10">
            {moveLoading ? (
              <div className="p-4 text-sm text-black/60">Loading…</div>
            ) : movements.length === 0 ? (
              <div className="p-4 text-sm text-black/60">No movements.</div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-black/10">
                    <th className="px-2 py-2">When</th>
                    <th className="px-2 py-2">Material</th>
                    <th className="px-2 py-2">Action</th>
                    <th className="px-2 py-2">Δ Qty</th>
                    <th className="px-2 py-2">User</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-b border-black/5">
                      <td className="px-2 py-2 whitespace-nowrap">{fmtWhen(m.created_at)}</td>
                      <td className="px-2 py-2">{m.material_name}</td>
                      <td className="px-2 py-2 capitalize">{m.action}</td>
                      <td className="px-2 py-2 tabular-nums">
                        {m.quantity_delta !== null && m.quantity_delta !== undefined ? String(m.quantity_delta) : "—"}
                        {m.meta && typeof m.meta.stock_level_before === "string" ? (
                          <span className="ml-1 text-black/50">
                            ({String(m.meta.stock_level_before)}→{String(m.meta.stock_level_after ?? "")})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">{m.actor_username || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={adjustOpen} title="Update quantity" onClose={() => setAdjustOpen(false)}>
        <div className="space-y-3 px-6 pb-6">
          <div className="text-sm text-black/70">
            {adjustRow ? (
              <>
                <span className="font-semibold text-black">{adjustRow.material_name}</span> — current qty:{" "}
                {fmtNum(adjustRow.quantity)} {adjustRow.unit}
              </>
            ) : null}
          </div>
          <label className="block">
            <div className="mb-1 text-sm font-medium">Action</div>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
              value={adjAction}
              onChange={(e) => setAdjAction(e.target.value as InventoryMovementAction)}
            >
              <option value="added">Added (receive stock)</option>
              <option value="used">Used (consumption)</option>
              <option value="adjusted">Adjusted (correction)</option>
            </select>
          </label>
          <Input
            label={adjAction === "used" ? "Quantity used (positive number)" : "Quantity change (use negative to decrease)"}
            type="text"
            inputMode="decimal"
            value={adjDelta}
            onChange={(e) => setAdjDelta(e.target.value)}
            hint={adjAction === "used" ? "We will record a negative movement of this amount." : undefined}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAdjustOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitAdjust()}>Apply</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={payOpen}
        title={payRow ? `Payments — ${payRow.material_name}` : "Payments"}
        onClose={() => {
          setPayOpen(false);
          setPayRow(null);
        }}
      >
        <div className="space-y-4 px-6 pb-6">
          {payRow ? (
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-black/50">Cost </span>
                <span className="font-semibold tabular-nums">{formatMoney(payRow.cost)}</span>
              </div>
              <div>
                <span className="text-black/50">Paid </span>
                <span className="font-semibold tabular-nums">{formatMoney(payRow.amount_paid)}</span>
              </div>
              <div>
                <span className="text-black/50">Balance </span>
                <span className="font-semibold tabular-nums">
                  {payRow.balance === null || payRow.balance === undefined ? "—" : formatMoney(payRow.balance)}
                </span>
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 border-t border-black/10 pt-4 md:grid-cols-3">
            <Input
              label="Amount"
              type="text"
              inputMode="decimal"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              error={payAmount.trim() && !isValidThousandsCommaNumber(payAmount) ? "Invalid comma formatting" : undefined}
            />
            <label className="block md:col-span-1">
              <div className="mb-1 text-sm font-medium">Payment date</div>
              <input
                type="datetime-local"
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </label>
            <div className="md:col-span-1 md:flex md:items-end">
              <Button className="w-full" disabled={paySaving || !payRow} onClick={() => void submitPayment()}>
                {paySaving ? "Saving…" : "Record payment"}
              </Button>
            </div>
          </div>
          <label className="block">
            <div className="mb-1 text-sm font-medium">Note (optional)</div>
            <textarea
              className="min-h-[72px] w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm"
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
            />
          </label>
          <div className="max-h-[280px] overflow-auto rounded-2xl border border-black/10">
            {payLoading ? (
              <div className="p-4 text-sm text-black/60">Loading…</div>
            ) : payList.length === 0 ? (
              <div className="p-4 text-sm text-black/60">No payments recorded yet.</div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-black/10">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Amount</th>
                    <th className="px-3 py-2">Note</th>
                    <th className="px-3 py-2">By</th>
                    {auth.role === "admin" ? <th className="px-3 py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {payList.map((p) => (
                    <tr key={p.id} className="border-b border-black/5">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtWhen(p.paid_at)}</td>
                      <td className="px-3 py-2 tabular-nums font-semibold">{formatMoney(p.amount)}</td>
                      <td className="px-3 py-2 text-black/70">{p.note || "—"}</td>
                      <td className="px-3 py-2">{p.recorded_by || "—"}</td>
                      {auth.role === "admin" ? (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="text-xs font-bold text-red-700 hover:underline"
                            onClick={() => void removePayment(p.id)}
                          >
                            Remove
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={bulkEditOpen} title="Bulk edit" onClose={() => setBulkEditOpen(false)}>
        <div className="space-y-3 px-6 pb-6">
          <div className="text-sm text-black/60">Applies to {selectedCount} selected row(s). All fields below are applied together.</div>
          <label className="block">
            <div className="mb-1 text-sm font-medium">Stock level</div>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
              value={bulkStock}
              onChange={(e) => setBulkStock(e.target.value as InventoryStockLevel)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="full">Full</option>
            </select>
          </label>
          <Input label="Supplier name" value={bulkSupplier} onChange={(e) => setBulkSupplier(e.target.value)} />
          <Input label="Category" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setBulkEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveBulkEdit()}>Apply</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
