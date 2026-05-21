import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { productionMaterialsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { usePageHeader } from "../components/layout/pageHeader";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import type {
  ProductionMaterialDisplayColumn,
  ProductionMaterialEmployeeRow,
  ProductionMaterialSection,
  ProductionMaterialSectionOverview,
  ProductionMaterialTransaction,
  ProductionMaterialType
} from "../types/api";
import { formatLagosDateTime } from "../utils/datetime";

function toDateTimeLocalValue(date: Date | string) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromDateTimeLocalValue(value: string) {
  return new Date(value).toISOString();
}

const SECTION_TABS: { key: ProductionMaterialSection; label: string }[] = [
  { key: "painters_dept", label: "Painters Dept" },
  { key: "mdf_section", label: "MDF Section" }
];

function fmtQty(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function totalForColumn(row: ProductionMaterialEmployeeRow, column: ProductionMaterialDisplayColumn) {
  const hit = row.material_totals.find((t) =>
    column.material_type_id != null
      ? t.material_type_id === column.material_type_id
      : t.material_name === column.material_name
  );
  return hit ? fmtQty(hit.total_quantity) : "0";
}

function columnKey(column: ProductionMaterialDisplayColumn) {
  return column.material_type_id != null ? `id:${column.material_type_id}` : `name:${column.material_name}`;
}

function statusLabel(status: ProductionMaterialTransaction["status"], txnType: ProductionMaterialTransaction["txn_type"]) {
  if (status === "voided") return "Voided";
  if (status === "superseded") return "Superseded";
  if (txnType === "reversal") return "Reversal";
  return "Active";
}

export function ProductionMaterialTrackingPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = (searchParams.get("section") || "painters_dept") as ProductionMaterialSection;

  const [overview, setOverview] = useState<ProductionMaterialSectionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<number | null>(null);
  const [history, setHistory] = useState<ProductionMaterialTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const [assignOptions, setAssignOptions] = useState<{ id: number; full_name: string }[]>([]);
  const [assignSelectedId, setAssignSelectedId] = useState<number | "">("");
  const [assignSaving, setAssignSaving] = useState(false);

  const [materialTypesOpen, setMaterialTypesOpen] = useState(false);
  const [newMaterialName, setNewMaterialName] = useState("");
  const [newMaterialUnit, setNewMaterialUnit] = useState("");
  const [materialSaving, setMaterialSaving] = useState(false);
  const [deleteMaterialTarget, setDeleteMaterialTarget] = useState<ProductionMaterialType | null>(null);
  const [deleteMaterialSaving, setDeleteMaterialSaving] = useState(false);

  const [allocOpen, setAllocOpen] = useState(false);
  const [allocEmployee, setAllocEmployee] = useState<ProductionMaterialEmployeeRow | null>(null);
  const [allocMaterialTypeId, setAllocMaterialTypeId] = useState<number | "">("");
  const [allocQty, setAllocQty] = useState("");
  const [allocUnit, setAllocUnit] = useState("");
  const [allocNotes, setAllocNotes] = useState("");
  const [allocWhen, setAllocWhen] = useState(() => toDateTimeLocalValue(new Date()));
  const [allocSaving, setAllocSaving] = useState(false);

  const [editTxn, setEditTxn] = useState<ProductionMaterialTransaction | null>(null);
  const [editMaterialTypeId, setEditMaterialTypeId] = useState<number | "">("");
  const [editQty, setEditQty] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editWhen, setEditWhen] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [reverseTxn, setReverseTxn] = useState<ProductionMaterialTransaction | null>(null);
  const [reverseQty, setReverseQty] = useState("");
  const [reverseNotes, setReverseNotes] = useState("");
  const [reverseSaving, setReverseSaving] = useState(false);

  const [voidTxn, setVoidTxn] = useState<ProductionMaterialTransaction | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidSaving, setVoidSaving] = useState(false);

  const [unassignTarget, setUnassignTarget] = useState<ProductionMaterialEmployeeRow | null>(null);
  const [unassignSaving, setUnassignSaving] = useState(false);

  usePageHeader({
    title: "Production Material Tracking",
    subtitle: "Track raw materials handed to contract employees by section"
  });

  const materialTypes = overview?.material_types ?? [];
  const displayColumns = overview?.display_columns ?? [];
  const employees = overview?.employees ?? [];
  const sectionTotals = overview?.section_totals ?? [];

  const editMaterialOptions = useMemo(() => {
    if (!editTxn) return materialTypes;
    if (editTxn.material_type_id == null) return materialTypes;
    if (materialTypes.some((mt) => mt.id === editTxn.material_type_id)) return materialTypes;
    return [
      {
        id: editTxn.material_type_id,
        section,
        name: `${editTxn.material_name} (archived)`,
        default_unit: editTxn.unit,
        is_active: false,
        created_at: editTxn.created_at
      },
      ...materialTypes
    ];
  }, [editTxn, materialTypes, section]);

  const setSection = (next: ProductionMaterialSection) => {
    const sp = new URLSearchParams(searchParams);
    sp.set("section", next);
    setSearchParams(sp);
    setExpandedEmployeeId(null);
    setHistory([]);
  };

  const refreshOverview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await productionMaterialsApi.getOverview(section);
      setOverview(data);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [section, toast]);

  const loadHistory = useCallback(
    async (contractEmployeeId: number) => {
      setHistoryLoading(true);
      try {
        const rows = await productionMaterialsApi.listEmployeeTransactions(section, contractEmployeeId, {
          include_inactive: true
        });
        setHistory(Array.isArray(rows) ? rows : []);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        setHistoryLoading(false);
      }
    },
    [section, toast]
  );

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  useEffect(() => {
    if (expandedEmployeeId != null) {
      void loadHistory(expandedEmployeeId);
    } else {
      setHistory([]);
    }
  }, [expandedEmployeeId, loadHistory]);

  const openAssignModal = async () => {
    setAssignOpen(true);
    setAssignSelectedId("");
    setAssignSearch("");
    try {
      const rows = await productionMaterialsApi.listContractEmployeeOptions(section);
      setAssignOptions(
        rows.filter((r) => !r.assigned_to_section).map((r) => ({ id: r.id, full_name: r.full_name }))
      );
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  };

  const filteredAssignOptions = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    if (!q) return assignOptions;
    return assignOptions.filter((o) => o.full_name.toLowerCase().includes(q));
  }, [assignOptions, assignSearch]);

  const submitAssign = async () => {
    if (assignSelectedId === "") return;
    setAssignSaving(true);
    try {
      await productionMaterialsApi.assignEmployee(section, { contract_employee_id: assignSelectedId });
      toast.push("success", "Employee assigned to section");
      setAssignOpen(false);
      await refreshOverview();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setAssignSaving(false);
    }
  };

  const submitUnassign = async () => {
    if (!unassignTarget) return;
    setUnassignSaving(true);
    try {
      await productionMaterialsApi.unassignEmployee(section, unassignTarget.assignment_id);
      toast.push("success", "Employee removed from section");
      if (expandedEmployeeId === unassignTarget.contract_employee_id) {
        setExpandedEmployeeId(null);
      }
      setUnassignTarget(null);
      await refreshOverview();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setUnassignSaving(false);
    }
  };

  const submitMaterialType = async () => {
    const name = newMaterialName.trim();
    if (!name) return;
    setMaterialSaving(true);
    try {
      await productionMaterialsApi.createMaterialType(section, {
        name,
        default_unit: newMaterialUnit.trim() || null
      });
      toast.push("success", "Material type added");
      setNewMaterialName("");
      setNewMaterialUnit("");
      await refreshOverview();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setMaterialSaving(false);
    }
  };

  const submitDeleteMaterialType = async () => {
    if (!deleteMaterialTarget) return;
    setDeleteMaterialSaving(true);
    try {
      await productionMaterialsApi.deleteMaterialType(deleteMaterialTarget.id);
      toast.push("success", "Material type archived. Historical records remain intact.");
      setDeleteMaterialTarget(null);
      await refreshOverview();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setDeleteMaterialSaving(false);
    }
  };

  const openAllocModal = (employee: ProductionMaterialEmployeeRow) => {
    setAllocEmployee(employee);
    setAllocMaterialTypeId(materialTypes[0]?.id ?? "");
    setAllocQty("");
    setAllocUnit("");
    setAllocNotes("");
    setAllocWhen(toDateTimeLocalValue(new Date()));
    setAllocOpen(true);
  };

  const submitAllocation = async () => {
    if (!allocEmployee || allocMaterialTypeId === "" || !allocQty.trim()) return;
    setAllocSaving(true);
    try {
      await productionMaterialsApi.createAllocation(section, allocEmployee.contract_employee_id, {
        material_type_id: allocMaterialTypeId,
        quantity: allocQty.trim(),
        unit: allocUnit.trim() || null,
        transaction_at: fromDateTimeLocalValue(allocWhen),
        notes: allocNotes.trim() || null
      });
      toast.push("success", "Material recorded");
      setAllocOpen(false);
      await refreshOverview();
      if (expandedEmployeeId === allocEmployee.contract_employee_id) {
        await loadHistory(allocEmployee.contract_employee_id);
      }
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setAllocSaving(false);
    }
  };

  const openEditModal = (txn: ProductionMaterialTransaction) => {
    setEditTxn(txn);
    setEditMaterialTypeId(txn.material_type_id ?? "");
    setEditQty(fmtQty(txn.quantity));
    setEditUnit(txn.unit ?? "");
    setEditNotes(txn.notes ?? "");
    setEditWhen(toDateTimeLocalValue(txn.transaction_at));
  };

  const submitEdit = async () => {
    if (!editTxn || editMaterialTypeId === "" || !editQty.trim()) return;
    setEditSaving(true);
    try {
      await productionMaterialsApi.updateTransaction(editTxn.id, {
        material_type_id: editMaterialTypeId,
        quantity: editQty.trim(),
        unit: editUnit.trim() || null,
        transaction_at: fromDateTimeLocalValue(editWhen),
        notes: editNotes.trim() || null
      });
      toast.push("success", "Entry updated (previous version preserved in history)");
      setEditTxn(null);
      await refreshOverview();
      if (expandedEmployeeId != null) await loadHistory(expandedEmployeeId);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setEditSaving(false);
    }
  };

  const openReverseModal = (txn: ProductionMaterialTransaction) => {
    setReverseTxn(txn);
    setReverseQty(fmtQty(txn.quantity));
    setReverseNotes("");
  };

  const submitReverse = async () => {
    if (!reverseTxn || !reverseQty.trim()) return;
    setReverseSaving(true);
    try {
      await productionMaterialsApi.reverseTransaction(reverseTxn.id, {
        quantity: reverseQty.trim(),
        notes: reverseNotes.trim() || null
      });
      toast.push("success", "Reversal recorded");
      setReverseTxn(null);
      await refreshOverview();
      if (expandedEmployeeId != null) await loadHistory(expandedEmployeeId);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setReverseSaving(false);
    }
  };

  const submitVoid = async () => {
    if (!voidTxn) return;
    setVoidSaving(true);
    try {
      await productionMaterialsApi.voidTransaction(voidTxn.id, { reason: voidReason.trim() || null });
      toast.push("success", "Entry voided");
      setVoidTxn(null);
      setVoidReason("");
      await refreshOverview();
      if (expandedEmployeeId != null) await loadHistory(expandedEmployeeId);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setVoidSaving(false);
    }
  };

  const toggleExpand = (employeeId: number) => {
    setExpandedEmployeeId((prev) => (prev === employeeId ? null : employeeId));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-2xl border border-black/10 bg-white p-1">
          {SECTION_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSection(tab.key)}
              className={[
                "rounded-xl px-4 py-2 text-sm font-semibold transition",
                section === tab.key ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setMaterialTypesOpen(true)}>
            Material types
          </Button>
          <Button onClick={() => void openAssignModal()}>Assign employee</Button>
        </div>
      </div>

      {sectionTotals.length > 0 ? (
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-black/50">Section totals</div>
          <div className="mt-2 flex flex-wrap gap-3">
            {sectionTotals.map((t) => (
              <div key={`${t.material_type_id}-${t.material_name}`} className="rounded-xl border border-black/10 px-3 py-2 text-sm">
                <span className="font-semibold">{t.material_name}</span>
                <span className="text-black/60"> · {fmtQty(t.total_quantity)}</span>
                {t.unit ? <span className="text-black/50"> {t.unit}</span> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-sm text-black/60">Loading…</div>
        ) : employees.length === 0 ? (
          <div className="p-8 text-center text-sm text-black/60">
            No contract employees assigned to {overview?.section_label ?? "this section"} yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-black/10 bg-black/[0.02] text-left text-xs uppercase tracking-wide text-black/50">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  {displayColumns.map((col) => (
                    <th key={columnKey(col)} className="px-4 py-3 whitespace-nowrap">
                      {col.material_name}
                      {!col.is_selectable ? (
                        <span className="ml-1 text-[10px] font-normal uppercase text-black/40">archived</span>
                      ) : null}
                    </th>
                  ))}
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((row) => (
                  <Fragment key={row.contract_employee_id}>
                    <tr className="border-b border-black/5 hover:bg-black/[0.02]">
                      <td className="px-4 py-3 font-semibold">
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() => toggleExpand(row.contract_employee_id)}
                        >
                          {row.full_name}
                        </button>
                      </td>
                      {displayColumns.map((col) => (
                        <td key={columnKey(col)} className="px-4 py-3 tabular-nums">
                          {totalForColumn(row, col)}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button className="min-h-9 px-3 py-1.5 text-xs" variant="secondary" onClick={() => openAllocModal(row)}>
                            Add material
                          </Button>
                          <Button className="min-h-9 px-3 py-1.5 text-xs" variant="ghost" onClick={() => toggleExpand(row.contract_employee_id)}>
                            {expandedEmployeeId === row.contract_employee_id ? "Hide history" : "History"}
                          </Button>
                          <Button className="min-h-9 px-3 py-1.5 text-xs" variant="ghost" onClick={() => setUnassignTarget(row)}>
                            Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expandedEmployeeId === row.contract_employee_id ? (
                      <tr className="bg-black/[0.02]">
                        <td colSpan={displayColumns.length + 2} className="px-4 py-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-black/50">Material ledger</div>
                          {historyLoading ? (
                            <div className="mt-2 text-sm text-black/60">Loading history…</div>
                          ) : history.length === 0 ? (
                            <div className="mt-2 text-sm text-black/60">No material entries yet.</div>
                          ) : (
                            <div className="mt-3 overflow-x-auto">
                              <table className="min-w-full text-sm">
                                <thead>
                                  <tr className="text-left text-xs uppercase tracking-wide text-black/50">
                                    <th className="pb-2 pr-4">Date</th>
                                    <th className="pb-2 pr-4">Material</th>
                                    <th className="pb-2 pr-4">Qty</th>
                                    <th className="pb-2 pr-4">Given by</th>
                                    <th className="pb-2 pr-4">Status</th>
                                    <th className="pb-2 pr-4">Notes</th>
                                    <th className="pb-2">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {history.map((txn) => (
                                    <tr key={txn.id} className="border-t border-black/5">
                                      <td className="py-2 pr-4 whitespace-nowrap">{formatLagosDateTime(txn.transaction_at)}</td>
                                      <td className="py-2 pr-4">{txn.material_name}</td>
                                      <td className="py-2 pr-4 tabular-nums">
                                        {txn.txn_type === "reversal" ? "-" : ""}
                                        {fmtQty(txn.quantity)}
                                        {txn.unit ? ` ${txn.unit}` : ""}
                                      </td>
                                      <td className="py-2 pr-4">{txn.given_by ?? "—"}</td>
                                      <td className="py-2 pr-4">{statusLabel(txn.status, txn.txn_type)}</td>
                                      <td className="py-2 pr-4 max-w-xs truncate">{txn.notes || "—"}</td>
                                      <td className="py-2">
                                        {txn.status === "active" && txn.txn_type === "allocation" ? (
                                          <div className="flex flex-wrap gap-1">
                                            <Button className="min-h-8 px-2 py-1 text-xs" variant="ghost" onClick={() => openEditModal(txn)}>
                                              Edit
                                            </Button>
                                            <Button className="min-h-8 px-2 py-1 text-xs" variant="ghost" onClick={() => openReverseModal(txn)}>
                                              Reverse
                                            </Button>
                                            <Button className="min-h-8 px-2 py-1 text-xs" variant="ghost" onClick={() => setVoidTxn(txn)}>
                                              Void
                                            </Button>
                                          </div>
                                        ) : txn.status === "active" && txn.txn_type === "reversal" ? (
                                          <Button className="min-h-8 px-2 py-1 text-xs" variant="ghost" onClick={() => setVoidTxn(txn)}>
                                            Void
                                          </Button>
                                        ) : (
                                          <span className="text-black/40">—</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={assignOpen} title="Assign contract employee" onClose={() => setAssignOpen(false)}>
        <div className="space-y-3">
          <Input placeholder="Search employees…" value={assignSearch} onChange={(e) => setAssignSearch(e.target.value)} />
          <select
            className="w-full rounded-xl border border-black/15 px-3 py-2 text-sm"
            value={assignSelectedId}
            onChange={(e) => setAssignSelectedId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Select employee</option>
            {filteredAssignOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.full_name}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button disabled={assignSaving || assignSelectedId === ""} onClick={() => void submitAssign()}>
              {assignSaving ? "Assigning…" : "Assign"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={materialTypesOpen} title="Saved material types" onClose={() => setMaterialTypesOpen(false)}>
        <div className="space-y-4">
          <p className="text-xs text-black/60">
            Archive unused materials to hide them from new allocations. Historical records and totals stay intact.
          </p>
          <div className="space-y-2">
            {materialTypes.length === 0 ? (
              <div className="rounded-xl border border-black/10 px-3 py-2 text-sm text-black/60">
                No active material types in this section.
              </div>
            ) : (
              materialTypes.map((mt: ProductionMaterialType) => (
                <div key={mt.id} className="flex items-center justify-between gap-3 rounded-xl border border-black/10 px-3 py-2 text-sm">
                  <div>
                    <span className="font-semibold">{mt.name}</span>
                    {mt.default_unit ? <span className="text-black/50"> · {mt.default_unit}</span> : null}
                  </div>
                  <Button className="min-h-9 px-3 py-1.5 text-xs" variant="ghost" onClick={() => setDeleteMaterialTarget(mt)}>
                    Delete
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Material name" value={newMaterialName} onChange={(e) => setNewMaterialName(e.target.value)} />
            <Input placeholder="Default unit (optional)" value={newMaterialUnit} onChange={(e) => setNewMaterialUnit(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMaterialTypesOpen(false)}>
              Close
            </Button>
            <Button disabled={materialSaving || !newMaterialName.trim()} onClick={() => void submitMaterialType()}>
              {materialSaving ? "Adding…" : "Add material type"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={allocOpen} title={`Add material — ${allocEmployee?.full_name ?? ""}`} onClose={() => setAllocOpen(false)}>
        <div className="space-y-3">
          <select
            className="w-full rounded-xl border border-black/15 px-3 py-2 text-sm"
            value={allocMaterialTypeId}
            onChange={(e) => setAllocMaterialTypeId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Select material</option>
            {materialTypes.map((mt) => (
              <option key={mt.id} value={mt.id}>
                {mt.name}
              </option>
            ))}
          </select>
          <Input placeholder="Quantity" value={allocQty} onChange={(e) => setAllocQty(e.target.value)} />
          <Input placeholder="Unit (optional)" value={allocUnit} onChange={(e) => setAllocUnit(e.target.value)} />
          <Input type="datetime-local" value={allocWhen} onChange={(e) => setAllocWhen(e.target.value)} />
          <Input placeholder="Notes (optional)" value={allocNotes} onChange={(e) => setAllocNotes(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAllocOpen(false)}>
              Cancel
            </Button>
            <Button disabled={allocSaving} onClick={() => void submitAllocation()}>
              {allocSaving ? "Saving…" : "Record material"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editTxn} title="Edit material entry" onClose={() => setEditTxn(null)}>
        <div className="space-y-3">
          <p className="text-xs text-black/60">Edits preserve the original entry in history and create a replacement transaction.</p>
          <select
            className="w-full rounded-xl border border-black/15 px-3 py-2 text-sm"
            value={editMaterialTypeId}
            onChange={(e) => setEditMaterialTypeId(e.target.value ? Number(e.target.value) : "")}
          >
            {editMaterialOptions.map((mt) => (
              <option key={mt.id} value={mt.id}>
                {mt.name}
              </option>
            ))}
          </select>
          <Input placeholder="Quantity" value={editQty} onChange={(e) => setEditQty(e.target.value)} />
          <Input placeholder="Unit (optional)" value={editUnit} onChange={(e) => setEditUnit(e.target.value)} />
          <Input type="datetime-local" value={editWhen} onChange={(e) => setEditWhen(e.target.value)} />
          <Input placeholder="Notes (optional)" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditTxn(null)}>
              Cancel
            </Button>
            <Button disabled={editSaving} onClick={() => void submitEdit()}>
              {editSaving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!reverseTxn} title="Reverse / return material" onClose={() => setReverseTxn(null)}>
        <div className="space-y-3">
          <p className="text-xs text-black/60">Creates a traceable reversal entry that reduces totals.</p>
          <Input placeholder="Quantity to reverse" value={reverseQty} onChange={(e) => setReverseQty(e.target.value)} />
          <Input placeholder="Notes (optional)" value={reverseNotes} onChange={(e) => setReverseNotes(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReverseTxn(null)}>
              Cancel
            </Button>
            <Button disabled={reverseSaving} onClick={() => void submitReverse()}>
              {reverseSaving ? "Saving…" : "Record reversal"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!voidTxn} title="Void material entry?" onClose={() => { setVoidTxn(null); setVoidReason(""); }}>
        <div className="space-y-3">
          <p className="text-sm text-black/70">The entry will be excluded from totals but remain visible in the audit history.</p>
          <Input placeholder="Reason (optional)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setVoidTxn(null); setVoidReason(""); }}>
              Cancel
            </Button>
            <Button variant="danger" isLoading={voidSaving} loadingLabel="Voiding…" onClick={() => void submitVoid()}>
              Void entry
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteMaterialTarget}
        title="Delete this material type?"
        message={`Delete "${deleteMaterialTarget?.name ?? "this material"}"? Historical records will remain intact, but it will no longer be available for new allocations.`}
        confirmLabel="Delete material type"
        busy={deleteMaterialSaving}
        onConfirm={() => void submitDeleteMaterialType()}
        onClose={() => setDeleteMaterialTarget(null)}
      />

      <ConfirmModal
        open={!!unassignTarget}
        title="Remove employee from section?"
        message={`Remove ${unassignTarget?.full_name ?? "this employee"} from ${overview?.section_label ?? "this section"}? Material history is preserved.`}
        confirmLabel="Remove"
        busy={unassignSaving}
        onConfirm={() => void submitUnassign()}
        onClose={() => setUnassignTarget(null)}
      />
    </div>
  );
}
