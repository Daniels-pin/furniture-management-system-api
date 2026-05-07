import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { quotationApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { PaginationFooter } from "../components/ui/Pagination";
import type { QuotationListItem } from "../types/api";
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

export function QuotationListPage() {
  const toast = useToast();
  const auth = useAuth();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<QuotationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<QuotationListItem | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await quotationApi.list({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
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

  async function confirmDeleteQuotation() {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    try {
      await quotationApi.delete(deleteTarget.id);
      toast.push("success", "Quotation moved to Trash.");
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setDeleteSubmitting(false);
    }
  }

  function QuoteCard({ r }: { r: QuotationListItem }) {
    return (
      <button
        type="button"
        className="w-full rounded-2xl border border-black/10 bg-white p-4 text-left shadow-soft transition hover:bg-black/[0.02] active:scale-[0.99]"
        onClick={() => nav(`/quotations/${r.id}`)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold">Quote #{r.quote_number}</div>
            <div className="mt-1 text-xs font-semibold text-black/60 break-words">{r.customer_name}</div>
          </div>
          <div className="shrink-0">{statusBadge(r.status)}</div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2">
            <div className="text-xs font-semibold text-black/55">Total</div>
            <div className="mt-0.5 text-sm font-bold tabular-nums">{formatMoney(r.grand_total)}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2">
            <div className="text-xs font-semibold text-black/55">Created</div>
            <div className="mt-0.5 text-[13px] font-semibold text-black">
              {new Date(r.created_at).toLocaleDateString()}
            </div>
            {r.created_by ? <div className="mt-0.5 text-[11px] font-semibold text-black/45">by {r.created_by}</div> : null}
          </div>
        </div>
        {(auth.role === "admin" || auth.role === "showroom") ? (
          <div className="mt-3 grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
            <Button variant="secondary" className="w-full" onClick={() => nav(`/quotations/${r.id}`)}>
              Open
            </Button>
            <Button
              variant="danger"
              className="w-full"
              onClick={() => setDeleteTarget(r)}
            >
              Delete
            </Button>
          </div>
        ) : (
          <div className="mt-3 text-xs font-semibold text-black/45">Tap to open</div>
        )}
      </button>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Quotation</div>
          <div className="mt-1 text-sm text-black/60">Early-stage pricing before proforma or invoice. Drafts: admin and showroom only.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {auth.role === "admin" || auth.role === "showroom" || auth.role === "finance" ? (
            <Button onClick={() => nav("/quotations/new")}>New quotation</Button>
          ) : null}
          <Button variant="secondary" onClick={() => void load()} isLoading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        {/* Mobile: cards */}
        <div className="space-y-3 md:hidden">
          {loading ? (
            <div className="text-sm text-black/60">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-black/60">No quotations yet.</div>
          ) : (
            rows.map((r) => <QuoteCard key={r.id} r={r} />)
          )}
        </div>

        {/* Desktop: keep table */}
        <div className="hidden min-w-0 overflow-x-touch md:block">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="text-black/60">
              <tr className="border-b border-black/10">
                <th className="py-3 pr-4 font-semibold">Quote #</th>
                <th className="py-3 pr-4 font-semibold">Customer</th>
                <th className="py-3 pr-4 font-semibold">Status</th>
                <th className="py-3 pr-4 font-semibold">Total</th>
                <th className="py-3 pr-4 font-semibold">Created</th>
                {auth.role === "admin" || auth.role === "showroom" ? <th className="py-3 pr-0 text-right font-semibold">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={auth.role === "admin" || auth.role === "showroom" ? 6 : 5} className="py-6 text-black/60">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={auth.role === "admin" || auth.role === "showroom" ? 6 : 5} className="py-6 text-black/60">
                    No quotations yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-black/5 transition hover:bg-black/[0.02]"
                    onClick={() => nav(`/quotations/${r.id}`)}
                  >
                    <td className="py-3 pr-4 font-semibold">#{r.quote_number}</td>
                    <td className="py-3 pr-4 text-black/80">{r.customer_name}</td>
                    <td className="py-3 pr-4">{statusBadge(r.status)}</td>
                    <td className="py-3 pr-4">{formatMoney(r.grand_total)}</td>
                    <td className="py-3 pr-4 text-black/60">
                      {new Date(r.created_at).toLocaleString()}
                      {r.created_by ? <span className="ml-2 text-black/40">· {r.created_by}</span> : null}
                    </td>
                    {auth.role === "admin" || auth.role === "showroom" ? (
                      <td className="py-3 pr-0 text-right">
                        <button
                          type="button"
                          className="text-xs font-bold text-red-700 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(r);
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationFooter page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </Card>

      <Modal
        open={deleteTarget !== null}
        title="Move quotation to Trash?"
        onClose={() => {
          if (!deleteSubmitting) setDeleteTarget(null);
        }}
      >
        <div className="space-y-4 px-6 pb-6">
          <p className="text-sm text-black/70">
            <span className="font-semibold text-black">#{deleteTarget?.quote_number}</span> for{" "}
            {deleteTarget?.customer_name} will be soft-deleted. You can restore it from the Trash page.
            {deleteTarget?.status === "converted" ? (
              <span className="mt-2 block">Any linked order or proforma invoice is not removed.</span>
            ) : null}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={deleteSubmitting} onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              className="border-red-600 bg-red-600 text-white hover:bg-red-700"
              disabled={deleteSubmitting}
              isLoading={deleteSubmitting}
              onClick={() => void confirmDeleteQuotation()}
            >
              Move to Trash
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
