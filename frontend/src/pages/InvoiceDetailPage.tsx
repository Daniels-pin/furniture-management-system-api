import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { invoicesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import type { InvoiceDetail } from "../types/api";
import { formatMoney } from "../utils/money";

export function InvoiceDetailPage() {
  const { invoiceId } = useParams();
  const id = Number(invoiceId);
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        if (!Number.isFinite(id)) throw new Error("bad id");
        const res = await invoicesApi.get(id);
        if (!alive) return;
        setData(res);
      } catch (e: any) {
        if (!alive) return;
        if (e?.response?.status === 404) setNotFound(true);
        else toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, toast]);

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end print:hidden">
        <div>
          <div className="text-2xl font-bold tracking-tight">Invoice</div>
          <div className="mt-1 text-sm text-black/60">
            {loading ? "Loading…" : data ? `#${data.invoice_number}` : notFound ? "Not found" : "—"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => nav("/invoices")}>
            Back
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              window.print();
            }}
          >
            Print / Download
          </Button>
          {data ? (
            <Button variant="secondary" onClick={() => nav(`/orders/${data.order_id}`)}>
              View order
            </Button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <Card>
          <div className="text-sm text-black/60">Loading…</div>
        </Card>
      ) : notFound || !data ? (
        <Card>
          <div className="text-sm font-semibold">Invoice not found</div>
        </Card>
      ) : (
        <div id="invoice-print-root" className="space-y-4">
          <Card className="print:border-0 print:shadow-none">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-lg font-bold">Nolimits Furniture Nig Ltd</div>
                <div className="mt-1 text-sm text-black/60">Invoice #{data.invoice_number}</div>
                <div className="mt-1 text-xs text-black/50">
                  Issued {new Date(data.created_at).toLocaleString()}
                </div>
              </div>
              <div className="text-right text-sm">
                <div className="font-semibold">Order</div>
                <div className="text-black/70">#{String(data.order_id).padStart(3, "0")}</div>
                <div className="mt-2 font-semibold">Payment status</div>
                <div className="capitalize text-black/70">{data.status}</div>
              </div>
            </div>

            {auth.role !== "manager" && data.customer ? (
              <div className="mt-6 border-t border-black/10 pt-4">
                <div className="text-sm font-semibold">Bill to</div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                  <div>
                    <span className="text-black/60">Name: </span>
                    <span className="font-semibold">{data.customer.name}</span>
                  </div>
                  <div>
                    <span className="text-black/60">Phone: </span>
                    <span className="font-semibold">{data.customer.phone ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-black/60">Email: </span>
                    <span className="font-semibold">{data.customer.email ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-black/60">Address: </span>
                    <span className="font-semibold">{data.customer.address ?? "—"}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 text-sm text-black/60 print:hidden">Customer details hidden for your role.</div>
            )}

            <div className="mt-6 border-t border-black/10 pt-4">
              <div className="text-sm font-semibold">Line items</div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-black/60">
                    <tr className="border-b border-black/10">
                      <th className="py-2 pr-4 font-semibold">Item</th>
                      <th className="py-2 pr-4 font-semibold">Description</th>
                      <th className="py-2 pr-0 text-right font-semibold">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it) => (
                      <tr key={it.id} className="border-b border-black/5">
                        <td className="py-2 pr-4 font-semibold">{it.item_name}</td>
                        <td className="py-2 pr-4 text-black/70">{it.description ?? "—"}</td>
                        <td className="py-2 pr-0 text-right">{it.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 border-t border-black/10 pt-4 md:grid-cols-3">
              <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                <div className="text-xs font-semibold text-black/60">Total price</div>
                <div className="mt-1 text-sm font-bold">{formatMoney(data.total_price)}</div>
              </div>
              <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                <div className="text-xs font-semibold text-black/60">Deposit made</div>
                <div className="mt-1 text-sm font-bold">{formatMoney(data.deposit_paid)}</div>
              </div>
              <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                <div className="text-xs font-semibold text-black/60">Balance</div>
                <div className="mt-1 text-sm font-bold">{formatMoney(data.balance)}</div>
              </div>
            </div>
            {data.due_date ? (
              <div className="mt-4 text-sm text-black/60">
                Due date: {new Date(data.due_date).toLocaleDateString()}
              </div>
            ) : null}
          </Card>
        </div>
      )}
    </div>
  );
}
