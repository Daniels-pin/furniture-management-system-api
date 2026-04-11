import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { FactoryToolDetail, ToolTrackingRecord } from "../types/api";
import { toolsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";

function fmtWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ToolDetailPage() {
  const { toolId } = useParams();
  const id = Number(toolId);
  const nav = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [detail, setDetail] = useState<FactoryToolDetail | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [coAssignee, setCoAssignee] = useState("");
  const [coNotes, setCoNotes] = useState("");
  const [coSaving, setCoSaving] = useState(false);

  const [returnSaving, setReturnSaving] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    setLoading(true);
    setNotFound(false);
    try {
      const d = await toolsApi.getDetail(id, { history_limit: 150 });
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

  const t = detail?.tool;

  async function saveEdit() {
    if (!t) return;
    const name = editName.trim();
    if (!name) {
      toast.push("error", "Name required");
      return;
    }
    setEditSaving(true);
    try {
      await toolsApi.update(t.id, { name, notes: editNotes.trim() || null });
      toast.push("success", "Saved");
      setEditOpen(false);
      await load();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setEditSaving(false);
    }
  }

  async function moveToTrash() {
    if (!t) return;
    if (!window.confirm(`Move “${t.name}” to Trash? You cannot delete while it is checked out.`)) return;
    try {
      await toolsApi.remove(t.id);
      toast.push("success", "Moved to Trash");
      nav("/equipment", { replace: true });
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  async function doCheckout() {
    if (!t) return;
    setCoSaving(true);
    try {
      await toolsApi.checkout({
        tool_id: t.id,
        borrower_name: coAssignee.trim() || null,
        notes: coNotes.trim() || null
      });
      toast.push("success", "Checked out");
      setCheckoutOpen(false);
      setCoAssignee("");
      setCoNotes("");
      await load();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setCoSaving(false);
    }
  }

  async function doReturn() {
    const rid = detail?.current_record_id;
    if (!rid) return;
    setReturnSaving(true);
    try {
      await toolsApi.returnRecord(rid);
      toast.push("success", "Marked returned");
      await load();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setReturnSaving(false);
    }
  }

  if (!Number.isFinite(id)) {
    return <div className="text-sm text-black/70">Invalid tool id.</div>;
  }
  if (loading) return <div className="text-sm text-black/60">Loading…</div>;
  if (notFound || !t) {
    return (
      <div className="rounded-2xl border border-black/10 bg-white p-6 text-sm text-black/70">
        Tool not found.{" "}
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
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{t.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-black/[0.06] px-2.5 py-0.5 text-xs font-bold text-black/80">
              Tool
            </span>
            {t.in_use ? (
              <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-950 ring-1 ring-amber-800/15">
                In use
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-950 ring-1 ring-emerald-800/15">
                Available
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEditName(t.name);
              setEditNotes(t.notes ?? "");
              setEditOpen(true);
            }}
          >
            Edit
          </Button>
          {!t.in_use ? (
            <Button type="button" onClick={() => setCheckoutOpen(true)}>
              Check out
            </Button>
          ) : (
            <Button type="button" onClick={() => void doReturn()} disabled={returnSaving}>
              {returnSaving ? "Saving…" : "Mark returned"}
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => void moveToTrash()}>
            Move to trash
          </Button>
        </div>
      </div>

      {t.notes ? (
        <Card className="!p-4">
          <div className="text-sm font-bold">Notes</div>
          <p className="mt-2 text-sm text-black/70">{t.notes}</p>
        </Card>
      ) : null}

      <Card className="!p-4">
        <div className="text-sm font-bold">History</div>
        <p className="mt-1 text-xs text-black/55">Check-outs and returns (newest first).</p>
        <div className="mt-4 min-w-0 overflow-x-touch rounded-2xl border border-black/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-black/[0.02] text-xs font-bold uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-3 py-2">Out</th>
                <th className="px-3 py-2">Returned</th>
                <th className="px-3 py-2">Assigned to</th>
                <th className="px-3 py-2">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {!detail?.records?.length ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-black/60">
                    No history yet.
                  </td>
                </tr>
              ) : (
                detail.records.map((r: ToolTrackingRecord) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-black/70">{fmtWhen(r.checkout_at)}</td>
                    <td className="px-3 py-2 text-black/70">{r.returned_at ? fmtWhen(r.returned_at) : "—"}</td>
                    <td className="px-3 py-2 text-black/70">{r.borrower_name ?? "—"}</td>
                    <td className="px-3 py-2 text-black/70">{r.checked_out_by ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={editOpen} title="Edit tool" onClose={() => !editSaving && setEditOpen(false)}>
        <Input label="Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
        <Input label="Notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={editSaving} onClick={() => setEditOpen(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={editSaving} onClick={() => void saveEdit()}>
            {editSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </Modal>

      <Modal open={checkoutOpen} title="Check out" onClose={() => !coSaving && setCheckoutOpen(false)}>
        <Input label="Assigned to (optional)" value={coAssignee} onChange={(e) => setCoAssignee(e.target.value)} hint="Employee name" />
        <Input label="Notes (optional)" value={coNotes} onChange={(e) => setCoNotes(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={coSaving} onClick={() => setCheckoutOpen(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={coSaving} onClick={() => void doCheckout()}>
            {coSaving ? "Saving…" : "Check out"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
