import { useCallback, useEffect, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { trashApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import type { TrashItem } from "../types/api";

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function rowKey(row: TrashItem) {
  return `${row.entity_type}-${row.entity_id}`;
}

export function TrashPage() {
  const toast = useToast();
  const auth = useAuth();
  const isAdmin = auth.role === "admin";
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<TrashItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trashApi.list();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const valid = new Set(items.map(rowKey));
    setSelected((prev) => {
      const next = new Set<string>();
      for (const k of prev) {
        if (valid.has(k)) next.add(k);
      }
      return next;
    });
  }, [items]);

  function toggleRow(row: TrashItem) {
    const k = rowKey(row);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(rowKey)));
    }
  }

  async function restore(row: TrashItem) {
    const key = `r-${row.entity_type}-${row.entity_id}`;
    setBusy(key);
    try {
      await trashApi.restore(row.entity_type, row.entity_id);
      toast.push("success", "Restored");
      await refresh();
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function purge(row: TrashItem) {
    if (!window.confirm(`Permanently delete ${row.label}? This cannot be undone.`)) {
      return;
    }
    const key = `p-${row.entity_type}-${row.entity_id}`;
    setBusy(key);
    try {
      await trashApi.purge(row.entity_type, row.entity_id);
      toast.push("success", "Permanently deleted");
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(rowKey(row));
        return next;
      });
      await refresh();
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function purgeSelected() {
    const rows = items.filter((r) => selected.has(rowKey(r)));
    if (rows.length === 0) return;
    const preview = rows.slice(0, 25);
    const extra = rows.length - preview.length;
    const previewLines =
      preview.map((r) => `• ${r.label}`).join("\n") + (extra > 0 ? `\n… and ${extra} more` : "");
    if (!window.confirm(`Permanently delete ${rows.length} selected item(s)? This cannot be undone.\n\n${previewLines}`)) {
      return;
    }
    setBusy("bulk");
    try {
      const res = await trashApi.purgeBulk(rows.map((r) => ({ entity_type: r.entity_type, entity_id: r.entity_id })));
      if (res.purged > 0) {
        toast.push("success", `Permanently deleted ${res.purged} item(s).`);
      }
      if (res.failed?.length) {
        toast.push(
          "error",
          `${res.failed.length} item(s) could not be purged (dependencies or no longer in trash).`
        );
      }
      setSelected(new Set());
      await refresh();
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function purgeAll() {
    if (items.length === 0) return;
    if (
      !window.confirm(
        `Permanently delete ALL ${items.length} item(s) in Trash? This cannot be undone.\n\n` +
          "Active records outside Trash are not affected."
      )
    ) {
      return;
    }
    setBusy("purge-all");
    try {
      const res = await trashApi.purgeAll();
      if (res.purged > 0) {
        toast.push("success", `Permanently deleted ${res.purged} item(s).`);
      }
      if (res.failed?.length) {
        toast.push(
          "error",
          `${res.failed.length} item(s) could not be purged (database constraints). Retry after resolving linked data.`
        );
      }
      setSelected(new Set());
      await refresh();
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const colCount = isAdmin ? 6 : 4;
  const allSelected = items.length > 0 && selected.size === items.length;
  const someSelected = selected.size > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Trash</div>
          <div className="mt-1 text-sm text-black/60">
            {isAdmin
              ? "All soft-deleted items. Restore or permanently delete (purge)."
              : "Items you deleted. Restore them or ask an admin to purge."}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && items.length > 0 ? (
            <>
              <Button
                type="button"
                variant="danger"
                disabled={busy !== null || !someSelected}
                isLoading={busy === "bulk"}
                onClick={() => void purgeSelected()}
              >
                Purge selected ({selected.size})
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy !== null}
                isLoading={busy === "purge-all"}
                onClick={() => void purgeAll()}
              >
                Purge all
              </Button>
            </>
          ) : null}
          <Button variant="secondary" onClick={() => void refresh()} isLoading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="text-black/60">
              <tr className="border-b border-black/10">
                {isAdmin ? (
                  <th className="w-10 py-3 pr-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-black/20"
                      checked={allSelected}
                      disabled={busy !== null || loading || items.length === 0}
                      onChange={toggleSelectAll}
                      aria-label="Select all rows"
                    />
                  </th>
                ) : null}
                <th className="py-3 pr-4 font-semibold">Deleted</th>
                <th className="py-3 pr-4 font-semibold">Type</th>
                <th className="py-3 pr-4 font-semibold">Item</th>
                {isAdmin ? <th className="py-3 pr-4 font-semibold">Deleted by</th> : null}
                <th className="py-3 pr-0 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="py-6 text-black/60" colSpan={colCount}>
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td className="py-6 text-black/60" colSpan={colCount}>
                    Trash is empty.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={rowKey(row)} className="border-b border-black/5">
                    {isAdmin ? (
                      <td className="py-3 pr-2 align-top">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-black/20"
                          checked={selected.has(rowKey(row))}
                          disabled={busy !== null}
                          onChange={() => toggleRow(row)}
                          aria-label={`Select ${row.label}`}
                        />
                      </td>
                    ) : null}
                    <td className="py-3 pr-4 font-semibold">{formatWhen(row.deleted_at)}</td>
                    <td className="py-3 pr-4 capitalize text-black/80">
                      {row.entity_type.replace(/_/g, " ")}
                    </td>
                    <td className="py-3 pr-4">{row.label}</td>
                    {isAdmin ? (
                      <td className="py-3 pr-4 text-black/70">
                        {row.deleted_by_username ?? `User #${row.deleted_by_id}`}
                      </td>
                    ) : null}
                    <td className="py-3 pr-0 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="secondary"
                          disabled={busy !== null}
                          isLoading={busy === `r-${row.entity_type}-${row.entity_id}`}
                          onClick={() => void restore(row)}
                        >
                          Restore
                        </Button>
                        {isAdmin ? (
                          <Button
                            variant="danger"
                            disabled={busy !== null}
                            isLoading={busy === `p-${row.entity_type}-${row.entity_id}`}
                            onClick={() => void purge(row)}
                          >
                            Purge
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
