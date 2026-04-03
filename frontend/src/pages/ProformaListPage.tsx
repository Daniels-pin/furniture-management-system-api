import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { proformaApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PaginationFooter } from "../components/ui/Pagination";
import type { ProformaListItem } from "../types/api";
import { formatMoney } from "../utils/money";

const PAGE_SIZE = 20;

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "draft")
    return <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/80">Draft</span>;
  if (s === "finalized")
    return <span className="rounded-full bg-black px-2 py-0.5 text-xs font-semibold text-white">Finalized</span>;
  if (s === "converted")
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">Converted</span>;
  return <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/70">{status}</span>;
}

export function ProformaListPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ProformaListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await proformaApi.list({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      setRows(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === "number" ? data.total : 0);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Proforma Invoice</div>
          <div className="mt-1 text-sm text-black/60">Quotations and pre-payment billing. Drafts are visible to admin and showroom only.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => nav("/proforma/new")}>New proforma</Button>
          <Button variant="secondary" onClick={() => void load()} isLoading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="text-black/60">
              <tr className="border-b border-black/10">
                <th className="py-3 pr-4 font-semibold">Proforma</th>
                <th className="py-3 pr-4 font-semibold">Customer</th>
                <th className="py-3 pr-4 font-semibold">Status</th>
                <th className="py-3 pr-4 font-semibold">Total</th>
                <th className="py-3 pr-0 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-6 text-black/60">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-black/60">
                    No proforma invoices yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-black/5 transition hover:bg-black/[0.02]"
                    onClick={() => nav(`/proforma/${r.id}`)}
                  >
                    <td className="py-3 pr-4 font-semibold">#{r.proforma_number}</td>
                    <td className="py-3 pr-4 text-black/80">{r.customer_name}</td>
                    <td className="py-3 pr-4">{statusBadge(r.status)}</td>
                    <td className="py-3 pr-4">{formatMoney(r.grand_total)}</td>
                    <td className="py-3 pr-0 text-black/60">
                      {new Date(r.created_at).toLocaleString()}
                      {r.created_by ? <span className="ml-2 text-black/40">· {r.created_by}</span> : null}
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
