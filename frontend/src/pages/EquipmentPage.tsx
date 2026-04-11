import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { FactoryMachine, FactoryTool, ToolTrackingDaySummary, ToolTrackingRecord } from "../types/api";
import { machinesApi, toolsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";

function todayYmd() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shiftYmd(ymd: string, deltaDays: number) {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function fmtWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type StatusFilter = "all" | "returned" | "in_use";
type DirKind = "all" | "tool" | "machine";
type DirStatus = "" | "available" | "in_use";

type DirRow =
  | { kind: "tool"; id: number; name: string; statusLabel: string; inUse: boolean }
  | { kind: "machine"; id: number; name: string; statusLabel: string; machineStatus: FactoryMachine["status"] };

function machineStatusLabel(s: FactoryMachine["status"]) {
  if (s === "in_use") return "In use";
  if (s === "maintenance") return "Maintenance";
  return "Available";
}

export function EquipmentPage() {
  const toast = useToast();
  const defaultDay = useMemo(() => todayYmd(), []);

  const [tools, setTools] = useState<FactoryTool[]>([]);
  const [machines, setMachines] = useState<FactoryMachine[]>([]);
  const [dirKind, setDirKind] = useState<DirKind>("all");
  const [dirStatus, setDirStatus] = useState<DirStatus>("");
  const [dirSearch, setDirSearch] = useState("");

  const [daysPage, setDaysPage] = useState<ToolTrackingDaySummary[]>([]);
  const [daysMeta, setDaysMeta] = useState({ page: 1, total_days: 0, per_page: 21 });

  const [selectedDate, setSelectedDate] = useState(defaultDay);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [records, setRecords] = useState<ToolTrackingRecord[]>([]);
  const [recTotal, setRecTotal] = useState(0);
  const [recPage, setRecPage] = useState(1);
  const recPerPage = 40;

  const [dirLoading, setDirLoading] = useState(true);
  const [daysLoading, setDaysLoading] = useState(false);
  const [recLoading, setRecLoading] = useState(false);

  const [toolModal, setToolModal] = useState(false);
  const [toolName, setToolName] = useState("");
  const [toolNotes, setToolNotes] = useState("");
  const [toolSaving, setToolSaving] = useState(false);

  const [machineModal, setMachineModal] = useState(false);
  const [mForm, setMForm] = useState({
    machine_name: "",
    category: "",
    serial_number: "",
    location: "",
    status: "available" as FactoryMachine["status"],
    notes: ""
  });
  const [mSaving, setMSaving] = useState(false);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [coToolId, setCoToolId] = useState<number | "">("");
  const [coAssignee, setCoAssignee] = useState("");
  const [coNotes, setCoNotes] = useState("");
  const [coSaving, setCoSaving] = useState(false);

  const [returningId, setReturningId] = useState<number | null>(null);

  const loadDirectory = useCallback(async () => {
    setDirLoading(true);
    try {
      const [tlist, mlist] = await Promise.all([toolsApi.list(), machinesApi.list()]);
      setTools(Array.isArray(tlist) ? tlist : []);
      setMachines(Array.isArray(mlist) ? mlist : []);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setDirLoading(false);
    }
  }, [toast]);

  const loadDays = useCallback(async () => {
    setDaysLoading(true);
    try {
      const res = await toolsApi.trackingDays({ page: 1, per_page: 21 });
      setDaysPage(Array.isArray(res.items) ? res.items : []);
      setDaysMeta({
        page: res.page,
        total_days: res.total_days,
        per_page: res.per_page
      });
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setDaysLoading(false);
    }
  }, [toast]);

  const loadRecords = useCallback(async () => {
    setRecLoading(true);
    try {
      const res = await toolsApi.trackingByDay({
        date: selectedDate,
        status: statusFilter,
        page: recPage,
        per_page: recPerPage
      });
      setRecords(Array.isArray(res.items) ? res.items : []);
      setRecTotal(typeof res.total === "number" ? res.total : 0);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setRecLoading(false);
    }
  }, [toast, selectedDate, statusFilter, recPage]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  useEffect(() => {
    void loadDays();
  }, [loadDays]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    setRecPage(1);
  }, [selectedDate, statusFilter]);

  const directoryRows = useMemo(() => {
    const q = dirSearch.trim().toLowerCase();
    const rows: DirRow[] = [];
    if (dirKind !== "machine") {
      for (const t of tools) {
        if (q && !t.name.toLowerCase().includes(q)) continue;
        const inUse = t.in_use;
        if (dirStatus === "in_use" && !inUse) continue;
        if (dirStatus === "available" && inUse) continue;
        rows.push({
          kind: "tool",
          id: t.id,
          name: t.name,
          inUse,
          statusLabel: inUse ? "In use" : "Available"
        });
      }
    }
    if (dirKind !== "tool") {
      for (const m of machines) {
        if (q && !m.machine_name.toLowerCase().includes(q)) continue;
        const label = machineStatusLabel(m.status);
        if (dirStatus === "in_use" && m.status !== "in_use") continue;
        if (dirStatus === "available" && m.status !== "available") continue;
        rows.push({
          kind: "machine",
          id: m.id,
          name: m.machine_name,
          statusLabel: label,
          machineStatus: m.status
        });
      }
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return rows;
  }, [tools, machines, dirKind, dirStatus, dirSearch]);

  async function submitTool() {
    const name = toolName.trim();
    if (!name) {
      toast.push("error", "Enter a tool name");
      return;
    }
    setToolSaving(true);
    try {
      await toolsApi.create({ name, notes: toolNotes.trim() || null });
      toast.push("success", "Tool added");
      setToolModal(false);
      setToolName("");
      setToolNotes("");
      await loadDirectory();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setToolSaving(false);
    }
  }

  async function submitMachine() {
    const name = mForm.machine_name.trim();
    if (!name) {
      toast.push("error", "Enter a machine name");
      return;
    }
    setMSaving(true);
    try {
      await machinesApi.create({
        machine_name: name,
        category: mForm.category.trim() || null,
        serial_number: mForm.serial_number.trim() || null,
        location: mForm.location.trim() || null,
        status: mForm.status,
        notes: mForm.notes.trim() || null
      });
      toast.push("success", "Machine added");
      setMachineModal(false);
      setMForm({
        machine_name: "",
        category: "",
        serial_number: "",
        location: "",
        status: "available",
        notes: ""
      });
      await loadDirectory();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setMSaving(false);
    }
  }

  async function submitCheckout() {
    if (!coToolId) {
      toast.push("error", "Select a tool");
      return;
    }
    setCoSaving(true);
    try {
      await toolsApi.checkout({
        tool_id: coToolId,
        borrower_name: coAssignee.trim() || null,
        notes: coNotes.trim() || null
      });
      toast.push("success", "Checked out");
      setCheckoutOpen(false);
      setCoToolId("");
      setCoAssignee("");
      setCoNotes("");
      await Promise.all([loadDirectory(), loadDays(), loadRecords()]);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setCoSaving(false);
    }
  }

  async function markReturned(rec: ToolTrackingRecord) {
    setReturningId(rec.id);
    try {
      await toolsApi.returnRecord(rec.id);
      toast.push("success", `${rec.tool_name} marked returned`);
      await Promise.all([loadDirectory(), loadDays(), loadRecords()]);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setReturningId(null);
    }
  }

  const availableForCheckout = tools.filter((t) => !t.in_use);
  const recPages = Math.max(1, Math.ceil(recTotal / recPerPage));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-black/50">Factory</div>
          <h1 className="text-2xl font-bold tracking-tight">Equipment</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setToolModal(true)}>
            New tool
          </Button>
          <Button type="button" variant="secondary" onClick={() => setMachineModal(true)}>
            New machine
          </Button>
          <Button type="button" onClick={() => setCheckoutOpen(true)} disabled={availableForCheckout.length === 0}>
            Check out tool
          </Button>
          <Link
            to="/inventory"
            className="inline-flex items-center justify-center rounded-xl border border-black/15 bg-white px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]"
          >
            Inventory
          </Link>
        </div>
      </div>

      <Card className="!p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-bold">Directory</div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "All types"],
                ["tool", "Tools only"],
                ["machine", "Machines only"]
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setDirKind(k)}
                className={[
                  "rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition",
                  dirKind === k ? "bg-black text-white ring-black" : "bg-white text-black/70 ring-black/10 hover:bg-black/[0.03]"
                ].join(" ")}
              >
                {label}
              </button>
            ))}
            <select
              className="rounded-full border border-black/15 bg-white px-3 py-1.5 text-xs font-bold"
              value={dirStatus}
              onChange={(e) => setDirStatus(e.target.value as DirStatus)}
            >
              <option value="">Any status</option>
              <option value="available">Available</option>
              <option value="in_use">In use</option>
            </select>
          </div>
        </div>
        <div className="mt-3 max-w-md">
          <Input value={dirSearch} onChange={(e) => setDirSearch(e.target.value)} placeholder="Search name…" />
        </div>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-black/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-black/[0.02] text-xs font-bold uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {dirLoading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-black/60">
                    Loading…
                  </td>
                </tr>
              ) : directoryRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-black/60">
                    No items match.
                  </td>
                </tr>
              ) : (
                directoryRows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="hover:bg-black/[0.015]">
                    <td className="px-3 py-2">
                      <span className="inline-flex rounded-full bg-black/[0.06] px-2 py-0.5 text-xs font-bold capitalize text-black/80">
                        {r.kind}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-semibold">{r.name}</td>
                    <td className="px-3 py-2 text-black/70">{r.statusLabel}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={r.kind === "tool" ? `/equipment/tool/${r.id}` : `/equipment/machine/${r.id}`}
                        className="inline-flex rounded-xl border border-black/15 bg-white px-3 py-1.5 text-xs font-bold hover:bg-black/[0.03]"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
        <Card className="!p-4">
          <div className="text-sm font-bold">Tool check-outs by day</div>
          <p className="mt-1 text-xs text-black/55">Grouped by checkout date (UTC calendar day).</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setSelectedDate((d) => shiftYmd(d, -1))}>
              Prev
            </Button>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="max-w-[11rem]"
            />
            <Button type="button" variant="secondary" onClick={() => setSelectedDate((d) => shiftYmd(d, 1))}>
              Next
            </Button>
            <Button type="button" variant="secondary" onClick={() => setSelectedDate(defaultDay)}>
              Today
            </Button>
          </div>

          <div className="mt-5 text-xs font-bold uppercase tracking-wide text-black/50">Days with activity</div>
          <div className="mt-2 max-h-[320px] space-y-1 overflow-auto pr-1">
            {daysLoading ? (
              <div className="text-sm text-black/60">Loading…</div>
            ) : daysPage.length === 0 ? (
              <div className="text-sm text-black/60">No check-outs yet.</div>
            ) : (
              daysPage.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setSelectedDate(d.date)}
                  className={[
                    "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-semibold transition",
                    d.date === selectedDate
                      ? "border-black bg-black text-white"
                      : "border-black/10 bg-white hover:bg-black/[0.03]"
                  ].join(" ")}
                >
                  <span>{d.date}</span>
                  <span className={d.date === selectedDate ? "text-white/80" : "text-black/50"}>
                    {d.still_out ? `${d.still_out} out` : "—"}
                  </span>
                </button>
              ))
            )}
          </div>
          {daysMeta.total_days > daysMeta.per_page ? (
            <div className="mt-2 text-xs text-black/50">
              Showing recent {daysMeta.per_page} of {daysMeta.total_days} days.
            </div>
          ) : null}
        </Card>

        <Card className="!p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-bold">Daily tool log — {selectedDate}</div>
              <div className="mt-1 text-xs text-black/55">{recTotal} record{recTotal === 1 ? "" : "s"}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["all", "All"],
                  ["in_use", "In use"],
                  ["returned", "Returned"]
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStatusFilter(k)}
                  className={[
                    "rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition",
                    statusFilter === k ? "bg-black text-white ring-black" : "bg-white text-black/70 ring-black/10 hover:bg-black/[0.03]"
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-black/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-black/[0.02] text-xs font-bold uppercase tracking-wide text-black/50">
                <tr>
                  <th className="px-3 py-2">Tool</th>
                  <th className="px-3 py-2">Out</th>
                  <th className="px-3 py-2">Returned</th>
                  <th className="px-3 py-2">Assigned to</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {recLoading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-black/60">
                      Loading…
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-black/60">
                      No rows for this day / filter.
                    </td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr key={r.id} className="hover:bg-black/[0.015]">
                      <td className="px-3 py-2 font-semibold">{r.tool_name}</td>
                      <td className="px-3 py-2 text-black/70">{fmtWhen(r.checkout_at)}</td>
                      <td className="px-3 py-2 text-black/70">{r.returned_at ? fmtWhen(r.returned_at) : "—"}</td>
                      <td className="px-3 py-2 text-black/70">{r.borrower_name ?? "—"}</td>
                      <td className="px-3 py-2 text-black/70">{r.checked_out_by ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {!r.returned_at ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={returningId === r.id}
                            onClick={() => void markReturned(r)}
                          >
                            {returningId === r.id ? "Saving…" : "Mark returned"}
                          </Button>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-700">Returned</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {recPages > 1 ? (
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button type="button" variant="secondary" disabled={recPage <= 1} onClick={() => setRecPage((p) => p - 1)}>
                Previous page
              </Button>
              <div className="text-xs font-semibold text-black/50">
                Page {recPage} / {recPages}
              </div>
              <Button type="button" variant="secondary" disabled={recPage >= recPages} onClick={() => setRecPage((p) => p + 1)}>
                Next page
              </Button>
            </div>
          ) : null}
        </Card>
      </div>

      <Modal open={toolModal} title="New tool" onClose={() => !toolSaving && setToolModal(false)}>
        <div className="space-y-3">
          <Input label="Name" value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="e.g. Circular saw #2" />
          <Input label="Notes (optional)" value={toolNotes} onChange={(e) => setToolNotes(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" disabled={toolSaving} onClick={() => setToolModal(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={toolSaving} onClick={() => void submitTool()}>
              {toolSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={machineModal} title="New machine" onClose={() => !mSaving && setMachineModal(false)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Name" value={mForm.machine_name} onChange={(e) => setMForm((f) => ({ ...f, machine_name: e.target.value }))} />
          </div>
          <Input label="Category" value={mForm.category} onChange={(e) => setMForm((f) => ({ ...f, category: e.target.value }))} />
          <Input label="Serial #" value={mForm.serial_number} onChange={(e) => setMForm((f) => ({ ...f, serial_number: e.target.value }))} />
          <Input label="Location" value={mForm.location} onChange={(e) => setMForm((f) => ({ ...f, location: e.target.value }))} />
          <div>
            <div className="mb-1 text-sm font-medium">Initial status</div>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-semibold"
              value={mForm.status}
              onChange={(e) => setMForm((f) => ({ ...f, status: e.target.value as FactoryMachine["status"] }))}
            >
              <option value="available">Available</option>
              <option value="in_use">In use</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <Input label="Notes" value={mForm.notes} onChange={(e) => setMForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={mSaving} onClick={() => setMachineModal(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={mSaving} onClick={() => void submitMachine()}>
            {mSaving ? "Saving…" : "Create"}
          </Button>
        </div>
      </Modal>

      <Modal open={checkoutOpen} title="Check out tool" onClose={() => !coSaving && setCheckoutOpen(false)}>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-black/60">Tool</label>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-semibold"
              value={coToolId === "" ? "" : String(coToolId)}
              onChange={(e) => setCoToolId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Select…</option>
              {availableForCheckout.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <Input label="Assigned to (optional)" value={coAssignee} onChange={(e) => setCoAssignee(e.target.value)} hint="Employee name" />
          <Input label="Notes (optional)" value={coNotes} onChange={(e) => setCoNotes(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" disabled={coSaving} onClick={() => setCheckoutOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={coSaving} onClick={() => void submitCheckout()}>
              {coSaving ? "Saving…" : "Check out"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
