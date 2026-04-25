import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { PaginationFooter } from "../components/ui/Pagination";
import { auditApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import type { AuditLogItem } from "../types/api";

const PAGE_SIZE = 25;

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AdminActivityLogPage() {
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [rows, setRows] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await auditApi.list({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      setRows(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === "number" ? data.total : 0);
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [page, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((r) => {
      const hay = [
        String(r.id),
        r.action,
        r.entity_type,
        r.entity_id == null ? "" : String(r.entity_id),
        r.actor ?? "",
        typeof r.meta === "string" ? r.meta : JSON.stringify(r.meta ?? {})
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    });
  }, [rows, q]);

  function ActivityCard({ r }: { r: AuditLogItem }) {
    const meta = r.meta == null ? "—" : typeof r.meta === "string" ? r.meta : JSON.stringify(r.meta);
    return (
      <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold">{r.action}</div>
            <div className="mt-1 text-xs font-semibold text-black/60">
              {formatWhen(r.created_at)} · {r.actor ?? "—"}
            </div>
            <div className="mt-1 text-xs font-semibold text-black/60 break-words">
              {r.entity_type}
              {r.entity_id != null ? ` #${r.entity_id}` : ""}
            </div>
          </div>
          <div className="shrink-0 rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/70">#{r.id}</div>
        </div>
        <div className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2">
          <div className="text-xs font-semibold text-black/55">Meta</div>
          <div className="mt-1 whitespace-pre-wrap break-words text-xs font-semibold text-black/70">{meta}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Activity Log</div>
          <div className="mt-1 text-sm text-black/60">System-wide actions performed by all users.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void refresh()} isLoading={isLoading}>
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <Input
          label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="action, user, entity, ID…"
        />
        <div className="mt-2 text-xs text-black/50">Search applies to the current page of results.</div>
        {/* Mobile: cards */}
        <div className="mt-4 space-y-3 md:hidden">
          {isLoading ? (
            <div className="text-sm text-black/60">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-black/60">No activity found.</div>
          ) : (
            filtered.map((r) => <ActivityCard key={r.id} r={r} />)
          )}
        </div>

        {/* Desktop: keep table */}
        <div className="mt-5 hidden min-w-0 overflow-x-touch md:block">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-black/60">
              <tr className="border-b border-black/10">
                <th className="py-3 pr-4 font-semibold">When</th>
                <th className="py-3 pr-4 font-semibold">Action</th>
                <th className="py-3 pr-4 font-semibold">Entity</th>
                <th className="py-3 pr-4 font-semibold">Actor</th>
                <th className="py-3 pr-0 font-semibold">Meta</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="py-6 text-black/60" colSpan={5}>
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td className="py-6 text-black/60" colSpan={5}>
                    No activity found.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-b border-black/5 align-top">
                    <td className="py-3 pr-4 font-semibold">{formatWhen(r.created_at)}</td>
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-black">{r.action}</div>
                    </td>
                    <td className="py-3 pr-4 text-black/70">
                      {r.entity_type}
                      {r.entity_id != null ? <span className="font-semibold text-black"> #{r.entity_id}</span> : null}
                    </td>
                    <td className="py-3 pr-4 text-black/70">{r.actor ?? "—"}</td>
                    <td className="py-3 pr-0 text-black/60">
                      <code className="whitespace-pre-wrap break-words text-xs">
                        {r.meta == null ? "—" : typeof r.meta === "string" ? r.meta : JSON.stringify(r.meta)}
                      </code>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationFooter page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </Card>
    </div>
  );
}

