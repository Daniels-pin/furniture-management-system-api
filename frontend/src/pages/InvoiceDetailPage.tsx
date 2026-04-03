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
import { APP_NAME } from "../config/app";

export function InvoiceDetailPage() {
  const { invoiceId } = useParams();
  const id = Number(invoiceId);
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sending, setSending] = useState(false);

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
            <Button
              variant="secondary"
              isLoading={sending}
              onClick={async () => {
                try {
                  setSending(true);
                  const res = await invoicesApi.sendEmail(data.id);
                  toast.push("success", res.message || "Invoice sent");
                } catch (e) {
                  toast.push("error", getErrorMessage(e));
                } finally {
                  setSending(false);
                }
              }}
            >
              Send to Email
            </Button>
          ) : null}
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
              <div className="flex items-start justify-between gap-6">
                <div className="flex items-start gap-3">
                  <img
                    src="/logo.png"
                    alt={`${APP_NAME} logo`}
                    className="h-14 w-14 object-contain print:h-12 print:w-12"
                  />
                  <div>
                    <div className="text-base font-bold tracking-tight text-black">{APP_NAME}</div>
                  </div>
                </div>

                <div className="min-w-[220px] text-right">
                  <div className="inline-flex items-center justify-end gap-2 rounded-none bg-black px-4 py-2 text-white">
                    <span className="text-xs font-bold tracking-[0.28em]">INVOICE</span>
                  </div>
                  <div className="mt-3 text-sm text-black">
                    <div>
                      <span className="text-black/60">Invoice Number:</span>{" "}
                      <span className="font-semibold">#{data.invoice_number}</span>
                    </div>
                    <div className="mt-1">
                      <span className="text-black/60">Date Issued:</span>{" "}
                      <span className="font-semibold">
                        {new Date(data.created_at).toLocaleDateString(undefined, { dateStyle: "long" })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
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

            <section className="mt-6 border-b border-black/10 pb-4 print:mt-5 print:border-black print:pb-3">
              <div className="grid grid-cols-1 gap-6 text-sm md:grid-cols-2">
                <div>
                  <div className="font-bold text-black">Bill From:</div>
                  <div className="mt-2 space-y-1 text-black/80">
                    <div className="font-semibold text-black">{APP_NAME}</div>
                    <div>Address</div>
                    <div>Phone Number</div>
                    <div>Email</div>
                  </div>
                </div>
                <div>
                  <div className="font-bold text-black">Bill To:</div>
                  <div className="mt-2 space-y-1 text-black/80">
                    <div className="font-semibold text-black">{auth.role !== "factory" ? data.customer?.name : "—"}</div>
                    <div>{auth.role !== "factory" ? data.customer?.address ?? "—" : "—"}</div>
                    <div>{auth.role !== "factory" ? data.customer?.phone ?? "—" : "—"}</div>
                    <div>{auth.role !== "factory" ? data.customer?.email ?? "—" : "—"}</div>
                  </div>
                </div>
              </div>
            </section>

            <section className="mt-6 print:mt-5">
              <div className="mt-3 overflow-x-auto print:overflow-visible">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm print:min-w-0">
                  <thead>
                    <tr className="bg-black/[0.03] text-black">
                      <th className="py-2 pl-3 pr-3 font-semibold">Item</th>
                      <th className="py-2 pr-3 font-semibold">Description</th>
                      <th className="py-2 pr-3 text-right font-semibold">Quantity</th>
                      <th className="py-2 pr-3 text-right font-semibold">Rate</th>
                      <th className="py-2 pr-3 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it) => (
                      <tr key={it.id} className="border-b border-black/15 print:border-black/40">
                        <td className="py-3 pl-3 pr-3 font-semibold text-black">{it.item_name}</td>
                        <td className="py-3 pr-3 text-black">{it.description ?? "—"}</td>
                        <td className="py-3 pr-3 text-right font-semibold text-black">{it.quantity}</td>
                        <td className="py-3 pr-3 text-right text-black/70">—</td>
                        <td className="py-3 pr-3 text-right text-black/70">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-6 border-t border-black/10 pt-4 print:mt-5 print:border-black print:pt-3">
              <div className="flex justify-end">
                <div className="w-full max-w-md space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="text-black/70">Subtotal:</div>
                    <div className="font-semibold text-black">{formatMoney(data.total_price)}</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-black/70">Discount</div>
                    <div className="font-semibold text-black">
                      -{formatMoney((data as any).discount_amount)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-black/70">Tax:</div>
                    <div className="font-semibold text-black">{formatMoney((data as any).tax)}</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-black/70">Paid:</div>
                    <div className="font-semibold text-black">{formatMoney(data.deposit_paid)}</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-black/70">Balance:</div>
                    <div className="font-semibold text-black">{formatMoney(data.balance)}</div>
                  </div>

                  <div className="mt-3 flex items-center justify-between bg-black px-4 py-2 text-white">
                    <div className="text-base font-bold">Total</div>
                    <div className="text-base font-bold">{formatMoney((data as any).total)}</div>
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t border-black/10 pt-3 text-sm text-black/80 print:border-black">
                <div className="font-bold text-black">Terms &amp; Conditions:</div>
                <div className="mt-1">All properties belongs to the company until full payment is made.</div>
              </div>
            </section>
          </article>
        </div>
      )}
    </div>
  );
}
