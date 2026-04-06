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

export function TrashPage() {
  const toast = useToast();
  const auth = useAuth();
  const isAdmin = auth.role === "admin";
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<TrashItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

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
    if (
      !window.confirm(
        `Permanently delete ${row.label}? This cannot be undone.`
      )
    ) {
      return;
    }
    const key = `p-${row.entity_type}-${row.entity_id}`;
    setBusy(key);
    try {
      await trashApi.purge(row.entity_type, row.entity_id);
      toast.push("success", "Permanently deleted");
      await refresh();
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

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
        <Button variant="secondary" onClick={() => void refresh()} isLoading={loading}>
          Refresh
        </Button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="text-black/60">
              <tr className="border-b border-black/10">
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
                  <td className="py-6 text-black/60" colSpan={isAdmin ? 5 : 4}>
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td className="py-6 text-black/60" colSpan={isAdmin ? 5 : 4}>
                    Trash is empty.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={`${row.entity_type}-${row.entity_id}`} className="border-b border-black/5">
                    <td className="py-3 pr-4 font-semibold">{formatWhen(row.deleted_at)}</td>
                    <td className="py-3 pr-4 capitalize">{row.entity_type}</td>
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
