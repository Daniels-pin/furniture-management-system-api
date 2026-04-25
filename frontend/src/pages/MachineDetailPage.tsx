import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { FactoryMachineDetail, MachineActivity, MachineStatus } from "../types/api";
import { machinesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { ConfirmModal } from "../components/ui/ConfirmModal";

function fmtWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function kindLabel(k: MachineActivity["kind"]) {
  switch (k) {
    case "usage_start":
      return "Usage started";
    case "usage_end":
      return "Usage ended";
    case "status_change":
      return "Status change";
    default:
      return "Note";
  }
}

export function MachineDetailPage() {
  const { machineId } = useParams();
  const id = Number(machineId);
  const nav = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [detail, setDetail] = useState<FactoryMachineDetail | null>(null);

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null);

  const [statusOpen, setStatusOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<MachineStatus>("available");
  const [statusSaving, setStatusSaving] = useState(false);

  const [useSaving, setUseSaving] = useState<"start" | "end" | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    setLoading(true);
    setNotFound(false);
    try {
      const d = await machinesApi.getDetail(id, { activity_limit: 150 });
      setDetail(d);
    } catch (e: unknown) {
      if ((e as { response?: { status?: number } })?.response?.status === 404) setNotFound(true);
      else toast.push("error", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const m = detail?.machine;

  async function postNote() {
    if (!m) return;
    setNoteSaving(true);
    try {
      await machinesApi.postActivity(m.id, { kind: "note", message: noteText.trim() || null });
      toast.push("success", "Note added");
      setNoteOpen(false);
      setNoteText("");
      await load();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setNoteSaving(false);
    }
  }

  async function postStatusChange() {
    if (!m) return;
    setStatusSaving(true);
    try {
      await machinesApi.postActivity(m.id, { kind: "status_change", new_status: newStatus, message: null });
      toast.push("success", "Status updated");
      setStatusOpen(false);
      await load();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setStatusSaving(false);
    }
  }

  async function usage(kind: "usage_start" | "usage_end") {
    if (!m) return;
    setUseSaving(kind === "usage_start" ? "start" : "end");
    try {
      await machinesApi.postActivity(m.id, { kind, message: null });
      toast.push("success", kind === "usage_start" ? "Marked in use" : "Marked available");
      await load();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setUseSaving(null);
    }
  }

  if (!Number.isFinite(id)) {
    return (
      <div className="rounded-2xl border border-black/10 bg-white p-6 text-sm text-black/70">
        Invalid machine id.
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-black/60">Loading…</div>;
  }

  if (notFound || !m) {
    return (
      <div className="rounded-2xl border border-black/10 bg-white p-6 text-sm text-black/70">
        Machine not found.{" "}
        <Link className="font-semibold underline" to="/equipment">
          Back to equipment
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link to="/equipment" className="text-xs font-bold text-black/50 hover:text-black">
            ← Equipment
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{m.machine_name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-black/[0.06] px-2.5 py-0.5 text-xs font-bold text-black/80">
              Machine
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-black/60">
            {m.category ? <span>Category: {m.category}</span> : null}
            {m.serial_number ? <span>Serial: {m.serial_number}</span> : null}
            {m.location ? <span>Location: {m.location}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={useSaving !== null || m.status !== "available"}
            onClick={() => void usage("usage_start")}
          >
            {useSaving === "start" ? "Saving…" : "Start use"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={useSaving !== null || m.status !== "in_use"}
            onClick={() => void usage("usage_end")}
          >
            {useSaving === "end" ? "Saving…" : "End use"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setNewStatus(m.status);
              setStatusOpen(true);
            }}
          >
            Set status
          </Button>
          <Button type="button" onClick={() => setNoteOpen(true)}>
            Add note
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              setConfirmAction(() => async () => {
                await machinesApi.remove(m.id);
                toast.push("success", "Moved to Trash");
                nav("/equipment", { replace: true });
              });
              setConfirmOpen(true);
            }}
          >
            Move to trash
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="text-sm font-bold">Current status</div>
        <div className="mt-2 text-lg font-bold capitalize">{m.status.replace("_", " ")}</div>
        {m.notes ? <p className="mt-2 text-sm text-black/70">{m.notes}</p> : null}
      </Card>

      <Card className="p-4">
        <div className="text-sm font-bold">Activity log</div>
        <p className="mt-1 text-xs text-black/55">Recent events and usage (newest first).</p>
        <div className="mt-4 min-w-0 overflow-x-touch rounded-2xl border border-black/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-black/[0.02] text-xs font-bold uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Detail</th>
                <th className="px-3 py-2">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {!detail?.activities?.length ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-black/60">
                    No activity yet.
                  </td>
                </tr>
              ) : (
                detail.activities.map((a: MachineActivity) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 text-black/70">{fmtWhen(a.created_at)}</td>
                    <td className="px-3 py-2 font-semibold">{kindLabel(a.kind)}</td>
                    <td className="max-w-md px-3 py-2 text-black/70">
                      {a.message ?? "—"}
                      {a.meta && typeof a.meta === "object" && "from" in a.meta ? (
                        <span className="mt-1 block text-xs text-black/50">
                          {String((a.meta as { from?: string }).from ?? "")} → {String((a.meta as { to?: string }).to ?? "")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-black/60">{a.recorded_by ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={noteOpen} title="Add note" onClose={() => !noteSaving && setNoteOpen(false)}>
        <Input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="What happened?" />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={noteSaving} onClick={() => setNoteOpen(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={noteSaving} onClick={() => void postNote()}>
            {noteSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </Modal>

      <Modal open={statusOpen} title="Set status" onClose={() => !statusSaving && setStatusOpen(false)}>
        <select
          className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-semibold"
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value as MachineStatus)}
        >
          <option value="available">Available</option>
          <option value="in_use">In use</option>
          <option value="maintenance">Maintenance</option>
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={statusSaving} onClick={() => setStatusOpen(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={statusSaving} onClick={() => void postStatusChange()}>
            {statusSaving ? "Saving…" : "Apply"}
          </Button>
        </div>
      </Modal>

      <ConfirmModal
        open={confirmOpen}
        title="Move machine to Trash"
        message={m ? `Move “${m.machine_name}” to Trash?` : "Move to Trash?"}
        busy={confirmBusy}
        onClose={() => (confirmBusy ? null : setConfirmOpen(false))}
        onConfirm={() => {
          const act = confirmAction;
          if (!act) return;
          setConfirmBusy(true);
          void act()
            .catch((e) => toast.push("error", getErrorMessage(e)))
            .finally(() => {
              setConfirmBusy(false);
              setConfirmOpen(false);
              setConfirmAction(null);
            });
        }}
      />
    </div>
  );
}
