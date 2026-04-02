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
    <div className="space-y-6">
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
            type="button"
            onClick={() => {
              window.print();
            }}
          >
            Print invoice
          </Button>
          {data ? (
            <Button variant="secondary" onClick={() => nav(`/orders/${data.order_id}`)}>
              View order
            </Button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <Card className="print:hidden">
          <div className="text-sm text-black/60">Loading…</div>
        </Card>
      ) : notFound || !data ? (
        <Card className="print:hidden">
          <div className="text-sm font-semibold">Invoice not found</div>
        </Card>
      ) : (
        <div className="invoice-print-area">
          <article className="rounded-3xl border border-black/10 bg-white p-6 shadow-soft print:rounded-none print:border-0 print:p-0 print:shadow-none">
            <header className="border-b border-black/10 pb-4 print:border-black print:pb-3">
              <h1 className="text-xl font-bold tracking-tight text-black">Nolimits Furniture Nig Ltd</h1>
              <p className="mt-2 text-sm font-semibold text-black">Invoice #{data.invoice_number}</p>
              <p className="mt-1 text-sm text-black/80">
                Date issued: {new Date(data.created_at).toLocaleDateString(undefined, { dateStyle: "long" })}
              </p>
            </header>

            {/* Screen-only: order link context (not part of formal print layout) */}
            <div className="mt-4 flex flex-wrap justify-between gap-4 border-b border-black/5 pb-4 text-sm print:hidden">
              <div>
                <span className="font-semibold text-black/60">Linked order</span>
                <div className="font-semibold">#{String(data.order_id).padStart(3, "0")}</div>
              </div>
              <div className="text-right">
                <span className="font-semibold text-black/60">Payment status</span>
                <div className="capitalize font-semibold">{data.status}</div>
              </div>
            </div>

            {auth.role !== "manager" && data.customer ? (
              <section className="mt-6 border-b border-black/10 pb-4 print:mt-5 print:border-black print:pb-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-black">Customer</h2>
                <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 print:gap-1">
                  <div>
                    <dt className="text-black/60">Name</dt>
                    <dd className="font-semibold text-black">{data.customer.name}</dd>
                  </div>
                  <div>
                    <dt className="text-black/60">Phone</dt>
                    <dd className="font-semibold text-black">{data.customer.phone ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-black/60">Email</dt>
                    <dd className="font-semibold text-black">{data.customer.email ?? "—"}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-black/60">Address</dt>
                    <dd className="font-semibold text-black">{data.customer.address ?? "—"}</dd>
                  </div>
                </dl>
              </section>
            ) : (
              <p className="mt-6 text-sm text-black/60 print:hidden">Customer details hidden for your role.</p>
            )}

            <section className="mt-6 print:mt-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-black">Items</h2>
              <div className="mt-3 overflow-x-auto print:overflow-visible">
                <table className="w-full min-w-[520px] border-collapse text-left text-sm print:min-w-0">
                  <thead>
                    <tr className="border-b-2 border-black text-black">
                      <th className="py-2 pr-4 font-semibold">Item</th>
                      <th className="py-2 pr-4 font-semibold">Description</th>
                      <th className="py-2 pr-0 text-right font-semibold">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it) => (
                      <tr key={it.id} className="border-b border-black/15 print:border-black/40">
                        <td className="py-2 pr-4 font-semibold text-black">{it.item_name}</td>
                        <td className="py-2 pr-4 text-black">{it.description ?? "—"}</td>
                        <td className="py-2 pr-0 text-right font-semibold text-black">{it.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-6 space-y-3 border-t border-black/10 pt-4 print:mt-5 print:border-black print:pt-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 print:grid-cols-3">
                <div className="rounded-xl border border-black/10 p-4 print:rounded-none print:border-black print:bg-white print:p-3">
                  <div className="text-xs font-semibold uppercase text-black/60">Total price</div>
                  <div className="mt-1 text-base font-bold text-black">{formatMoney(data.total_price)}</div>
                </div>
                <div className="rounded-xl border border-black/10 p-4 print:rounded-none print:border-black print:bg-white print:p-3">
                  <div className="text-xs font-semibold uppercase text-black/60">Deposit made</div>
                  <div className="mt-1 text-base font-bold text-black">{formatMoney(data.deposit_paid)}</div>
                </div>
                <div className="rounded-xl border border-black/10 p-4 print:rounded-none print:border-black print:bg-white print:p-3">
                  <div className="text-xs font-semibold uppercase text-black/60">Balance</div>
                  <div className="mt-1 text-base font-bold text-black">{formatMoney(data.balance)}</div>
                </div>
              </div>
              {data.due_date ? (
                <p className="text-sm font-semibold text-black">
                  Due date: {new Date(data.due_date).toLocaleDateString(undefined, { dateStyle: "long" })}
                </p>
              ) : null}
            </section>
          </article>
        </div>
      )}
    </div>
  );
}
