import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { waybillApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PaginationFooter } from "../components/ui/Pagination";
import type { WaybillListItem } from "../types/api";

const PAGE_SIZE = 20;

function deliveryBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "delivered")
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">Delivered</span>;
  if (s === "shipped")
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Shipped</span>;
  return <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/80">Pending</span>;
}

export function WaybillListPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<WaybillListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await waybillApi.list({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      setRows(Array.isArray(res.items) ? res.items : []);
      setTotal(typeof res.total === "number" ? res.total : 0);
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
          <div className="text-2xl font-bold tracking-tight">Waybills</div>
          <div className="mt-1 text-sm text-black/60">Delivery documents linked to orders. Admin and showroom only.</div>
        </div>
        <Button variant="secondary" onClick={() => void load()} isLoading={loading}>
          Refresh
        </Button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="text-black/60">
              <tr className="border-b border-black/10">
                <th className="py-3 pr-4 font-semibold">Waybill #</th>
                <th className="py-3 pr-4 font-semibold">Order</th>
                <th className="py-3 pr-4 font-semibold">Customer</th>
                <th className="py-3 pr-4 font-semibold">Status</th>
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
                    No waybills yet. Create one from an order page.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-black/5 transition hover:bg-black/[0.02]"
                    onClick={() => nav(`/waybills/${r.id}`)}
                  >
                    <td className="py-3 pr-4 font-semibold">#{r.waybill_number}</td>
                    <td className="py-3 pr-4 text-black/70">#{String(r.order_id).padStart(3, "0")}</td>
                    <td className="py-3 pr-4 text-black/80">{r.customer_name}</td>
                    <td className="py-3 pr-4">{deliveryBadge(r.delivery_status)}</td>
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
