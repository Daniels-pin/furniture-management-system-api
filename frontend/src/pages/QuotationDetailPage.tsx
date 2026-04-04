import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { quotationApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ConvertToInvoiceModal } from "../components/ConvertToInvoiceModal";
import type { QuotationDetail } from "../types/api";
import { formatMoney, parseMoneyNumber } from "../utils/money";
import { APP_NAME, COMPANY_CONTACT } from "../config/app";
import { DocumentPaymentFooter } from "../components/DocumentPaymentFooter";

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

export function QuotationDetailPage() {
  const { quotationId } = useParams();
  const id = Number(quotationId);
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<QuotationDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [convertInvoiceOpen, setConvertInvoiceOpen] = useState(false);

  async function refresh() {
    if (!Number.isFinite(id)) return;
    const res = await quotationApi.get(id);
    setData(res);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        if (!Number.isFinite(id)) throw new Error("bad id");
        const res = await quotationApi.get(id);
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

  const canEdit = data && data.status !== "converted";
  const canFinalize = data?.status === "draft";
  const canConvert =
    data &&
    data.status !== "converted" &&
    !data.converted_order_id &&
    !data.converted_proforma_id;
  const canDelete = auth.role === "admin" && data && data.status !== "converted";

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end print:hidden">
        <div>
          <div className="text-2xl font-bold tracking-tight">Quotation</div>
          <div className="mt-1 text-sm text-black/60">
            {loading ? "Loading…" : data ? `#${data.quote_number}` : notFound ? "Not found" : "—"}
          </div>
          {data?.created_by ? (
            <div className="mt-1 text-xs font-semibold text-black/50">Created by {data.created_by}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => nav("/quotations")}>
            Back
          </Button>
          {canEdit ? (
            <Button variant="secondary" onClick={() => nav(`/quotations/${id}/edit`)}>
              Edit
            </Button>
          ) : null}
          {canFinalize ? (
            <Button
              variant="secondary"
              isLoading={acting}
              onClick={async () => {
                try {
                  setActing(true);
                  await quotationApi.finalize(id);
                  toast.push("success", "Quotation finalized.");
                  await refresh();
                } catch (e) {
                  toast.push("error", getErrorMessage(e));
                } finally {
                  setActing(false);
                }
              }}
            >
              Finalize
            </Button>
          ) : null}
          {data ? (
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    if (Number.isFinite(id)) await quotationApi.recordPrint(id);
                  } catch {
                    /* best-effort */
                  }
                  window.print();
                })();
              }}
            >
              Print
            </Button>
          ) : null}
          {data ? (
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    setActing(true);
                    await quotationApi.download(id);
                    toast.push("success", "Download started.");
                  } catch (e) {
                    toast.push("error", getErrorMessage(e));
                  } finally {
                    setActing(false);
                  }
                })();
              }}
            >
              Download
            </Button>
          ) : null}
          {data ? (
            <Button
              variant="secondary"
              isLoading={sending}
              onClick={async () => {
                try {
                  setSending(true);
                  const res = await quotationApi.sendEmail(data.id);
                  toast.push("success", res.message || "Sent");
                  await refresh();
                } catch (e) {
                  toast.push("error", getErrorMessage(e));
                } finally {
                  setSending(false);
                }
              }}
            >
              Send email
            </Button>
          ) : null}
          {data && canConvert ? (
            <Button
              variant="secondary"
              isLoading={acting}
              onClick={async () => {
                if (!window.confirm("Create a proforma invoice from this quotation?")) return;
                try {
                  setActing(true);
                  const res = await quotationApi.convertToProforma(id);
                  toast.push("success", res.message || "Converted");
                  nav(`/proforma/${res.proforma_id}`);
                } catch (e) {
                  toast.push("error", getErrorMessage(e));
                } finally {
                  setActing(false);
                }
              }}
            >
              Convert to proforma
            </Button>
          ) : null}
          {data && canConvert ? (
            <Button onClick={() => setConvertInvoiceOpen(true)}>Convert to invoice</Button>
          ) : null}
          {data?.converted_proforma_id ? (
            <Button variant="secondary" onClick={() => nav(`/proforma/${data.converted_proforma_id}`)}>
              View proforma
            </Button>
          ) : null}
          {data?.converted_order_id ? (
            <Button variant="secondary" onClick={() => nav(`/orders/${data.converted_order_id}`)}>
              View order
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              variant="secondary"
              className="border-red-600 text-red-700 hover:bg-red-50"
              isLoading={acting}
              onClick={async () => {
                if (!window.confirm("Delete this quotation permanently?")) return;
                try {
                  setActing(true);
                  await quotationApi.delete(id);
                  toast.push("success", "Quotation deleted.");
                  nav("/quotations");
                } catch (e) {
                  toast.push("error", getErrorMessage(e));
                } finally {
                  setActing(false);
                }
              }}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <ConvertToInvoiceModal
        open={convertInvoiceOpen}
        onClose={() => setConvertInvoiceOpen(false)}
        documentLabel="quotation"
        grandTotal={data?.grand_total}
        isSubmitting={acting}
        onConfirm={async (amountPaid) => {
          try {
            setActing(true);
            const res = await quotationApi.convertToInvoice(id, { amount_paid: amountPaid });
            toast.push("success", res.message || "Converted");
            setConvertInvoiceOpen(false);
            nav(`/invoices/${res.invoice_id}`);
          } catch (e) {
            toast.push("error", getErrorMessage(e));
          } finally {
            setActing(false);
          }
        }}
      />

      {loading ? (
        <Card className="print:hidden">
          <div className="text-sm text-black/60">Loading…</div>
        </Card>
      ) : notFound || !data ? (
        <Card className="print:hidden">
          <div className="text-sm font-semibold">Quotation not found</div>
        </Card>
      ) : (
        <div className="invoice-print-area">
          <article className="rounded-3xl border border-black/10 bg-white p-6 shadow-soft print:rounded-none print:border-0 print:p-0 print:shadow-none">
            <header className="border-b border-black/10 pb-4 print:border-black print:pb-3">
              <div className="flex items-center justify-between gap-6">
                <div className="flex flex-col items-center gap-1">
                  <img
                    src="/logo.png"
                    alt={`${APP_NAME} logo`}
                    className="block h-40 w-auto max-w-[min(100%,280px)] object-contain sm:h-44 md:h-48 print:h-44 print:max-w-[240px]"
                  />
                  <div className="max-w-[280px] text-center text-sm font-semibold italic leading-snug tracking-wide text-black sm:text-base print:text-sm">
                    Furniture Nig Ltd
                  </div>
                </div>

                <div className="min-w-[220px] text-right">
                  <div className="inline-flex items-center justify-end gap-2 rounded-none bg-black px-4 py-2 text-white">
                    <span className="text-xs font-bold tracking-[0.2em]">QUOTATION</span>
                  </div>
                  <div className="mt-3 text-sm text-black">
                    <div>
                      <span className="text-black/60">Quote number:</span>{" "}
                      <span className="font-semibold">#{data.quote_number}</span>
                    </div>
                    <div className="mt-1">
                      <span className="text-black/60">Date issued:</span>{" "}
                      <span className="font-semibold">
                        {new Date(data.created_at).toLocaleDateString(undefined, { dateStyle: "long" })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </header>

            <div className="mt-4 flex flex-wrap justify-between gap-4 border-b border-black/5 pb-4 text-sm print:hidden">
              <div>
                <span className="font-semibold text-black/60">Status</span>
                <div className="mt-1">{statusBadge(data.status)}</div>
              </div>
              {data.due_date ? (
                <div className="text-right">
                  <span className="font-semibold text-black/60">Due date</span>
                  <div className="mt-1 font-semibold">
                    {new Date(data.due_date).toLocaleDateString(undefined, { dateStyle: "long" })}
                  </div>
                </div>
              ) : null}
            </div>

            <section className="mt-5 border-b border-black/10 pb-3 print:mt-4 print:border-black print:pb-2">
              <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 md:items-start md:gap-x-10">
                <div className="min-w-0">
                  <div className="font-bold text-black">Bill From:</div>
                  <div className="mt-1.5 space-y-0.5 leading-snug text-black/80">
                    <div className="font-semibold text-black">{APP_NAME}</div>
                    {COMPANY_CONTACT.addresses.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                    <div className="break-words">
                      {COMPANY_CONTACT.phones.join(", ")},{" "}
                      <a
                        href={`mailto:${COMPANY_CONTACT.email}`}
                        className="text-inherit underline decoration-black/40 underline-offset-2 print:text-black"
                      >
                        {COMPANY_CONTACT.email}
                      </a>
                    </div>
                  </div>
                </div>
                <div className="min-w-0 md:pl-6">
                  <div className="font-bold text-black">Bill To:</div>
                  <div className="mt-1.5 space-y-0.5 leading-snug text-black/80">
                    <div className="font-semibold text-black">{auth.role !== "factory" ? data.customer_name : "—"}</div>
                    <div>{auth.role !== "factory" ? data.address ?? "—" : "—"}</div>
                    <div>{auth.role !== "factory" ? data.phone ?? "—" : "—"}</div>
                    <div>{auth.role !== "factory" ? data.email ?? "—" : "—"}</div>
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
                      <th className="py-2 pr-3 text-right font-semibold">Amount</th>
                      <th className="py-2 pr-3 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it) => {
                      const unitNum = parseMoneyNumber(it.amount);
                      const qtyNum = Number(it.quantity);
                      const line =
                        unitNum !== null && Number.isFinite(qtyNum) ? unitNum * qtyNum : null;
                      return (
                        <tr key={it.id} className="border-b border-black/15 print:border-black/40">
                          <td className="py-3 pl-3 pr-3 font-semibold text-black">{it.item_name}</td>
                          <td className="py-3 pr-3 text-black">{it.description ?? "—"}</td>
                          <td className="py-3 pr-3 text-right font-semibold text-black">{it.quantity}</td>
                          <td className="py-3 pr-3 text-right font-semibold text-black">{formatMoney(unitNum)}</td>
                          <td className="py-3 pr-3 text-right font-semibold text-black">{formatMoney(line)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-6 border-t border-black/10 pt-4 print:mt-5 print:border-black print:pt-3">
              <div className="flex justify-end">
                <div className="w-full max-w-md space-y-2 text-sm">
                  {(() => {
                    const lineSum = data.items.reduce((sum, x) => {
                      const u = parseMoneyNumber(x.amount);
                      const q = Number(x.quantity);
                      if (u === null || !Number.isFinite(q)) return sum;
                      return sum + u * q;
                    }, 0);
                    const allResolved =
                      data.items.length > 0 && data.items.every((x) => parseMoneyNumber(x.amount) !== null);
                    const subtotalToShow = allResolved ? lineSum : data.subtotal;
                    return (
                      <div className="flex items-center justify-between">
                        <div className="text-black/70">Subtotal:</div>
                        <div className="font-semibold text-black">{formatMoney(subtotalToShow)}</div>
                      </div>
                    );
                  })()}
                  <div className="flex items-center justify-between">
                    <div className="text-black/70">Discount</div>
                    <div className="font-semibold text-black">-{formatMoney(data.discount_amount)}</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-black/70">
                      {data.tax_percent != null && data.tax_percent !== ""
                        ? `Tax (${data.tax_percent}%)`
                        : "Tax"}
                    </div>
                    <div className="font-semibold text-black">{formatMoney(data.tax)}</div>
                  </div>

                  <div className="mt-3 flex items-center justify-between bg-black px-4 py-2 text-white">
                    <div className="text-base font-bold">Total</div>
                    <div className="text-base font-bold">{formatMoney(data.grand_total)}</div>
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t border-black/10 pt-3 text-sm text-black/80 print:border-black">
                <div className="font-bold text-black">Terms &amp; Conditions:</div>
                <div className="mt-1">
                  This document is a quotation for pricing and negotiation only.
                </div>
              </div>
              <DocumentPaymentFooter />
            </section>
          </article>
        </div>
      )}
    </div>
  );
}
