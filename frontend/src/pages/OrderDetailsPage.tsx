import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { StatusBadge } from "../components/ui/StatusBadge";
import { ImageLightbox } from "../components/ui/ImageLightbox";
import { invoicesApi, ordersApi, waybillApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { formatMoney, parseMoneyNumber } from "../utils/money";
import { isValidThousandsCommaNumber, parseMoneyInput, sanitizeMoneyInput } from "../utils/moneyInput";
import type { OrderCreateItem, OrderStatus } from "../types/api";

type Details = Awaited<ReturnType<typeof ordersApi.get>>;

function isoToDateInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function formatCustomerBirthday(bd?: number | null, bm?: number | null) {
  if (bm == null || bd == null) return "—";
  const d = new Date(2000, Number(bm) - 1, Number(bd));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function discountLabel(dType?: unknown) {
  const t = typeof dType === "string" ? dType : "";
  if (t === "percentage") return "Percentage";
  if (t === "fixed") return "Fixed";
  return null;
}

function discountValueText(dType?: unknown, dValue?: unknown) {
  const t = typeof dType === "string" ? dType : "";
  if (!t) return null;
  if (t === "percentage") {
    const n = Number(dValue);
    return Number.isFinite(n) ? `${n}%` : `${String(dValue ?? "")}%`;
  }
  // fixed
  return formatMoney(dValue as any);
}

export function OrderDetailsPage() {
  const { orderId } = useParams();
  const nav = useNavigate();
  const location = useLocation() as any;
  const toast = useToast();
  const auth = useAuth();

  const id = useMemo(() => Number(orderId), [orderId]);
  const displayNumberFromState = location?.state?.displayNumber as string | number | undefined;
  const displayNumber = useMemo(() => {
    if (displayNumberFromState === undefined || displayNumberFromState === null) return null;
    const n = typeof displayNumberFromState === "number" ? displayNumberFromState : Number(displayNumberFromState);
    if (!Number.isFinite(n) || n <= 0) return null;
    return String(Math.trunc(n)).padStart(3, "0");
  }, [displayNumberFromState]);
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<Details | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [paying, setPaying] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [creatingWaybill, setCreatingWaybill] = useState(false);
  const [issuingInvoice, setIssuingInvoice] = useState(false);
  const [preInvoicePromptOpen, setPreInvoicePromptOpen] = useState(false);
  const [invoicePrepEditFlow, setInvoicePrepEditFlow] = useState(false);
  const [sendingOrderEmail, setSendingOrderEmail] = useState(false);
  const [downloadingOrderPdf, setDownloadingOrderPdf] = useState(false);
  const [waybillModalOpen, setWaybillModalOpen] = useState(false);
  const [wbDriverName, setWbDriverName] = useState("");
  const [wbDriverPhone, setWbDriverPhone] = useState("");
  const [wbVehiclePlate, setWbVehiclePlate] = useState("");

  const canEditOrder = auth.role === "admin" || auth.role === "showroom";
  const canIssueInvoice = auth.role === "admin" || auth.role === "showroom";
  const canSeeItemPricing = auth.role === "admin" || auth.role === "showroom" || auth.role === "finance";
  const canSeePricing = auth.role === "admin" || auth.role === "showroom" || auth.role === "finance";

  async function runIssueInvoice(orderId: number, orderEditedBeforeInvoice: boolean) {
    setIssuingInvoice(true);
    try {
      const res = await invoicesApi.issueForOrder(orderId, {
        orderEditedBeforeInvoice: orderEditedBeforeInvoice || undefined
      });
      toast.push("success", res.message || "Invoice created");
      const refreshed = await ordersApi.get(orderId);
      setData(refreshed);
      nav(`/invoices/${res.invoice_id}`);
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setIssuingInvoice(false);
    }
  }

  function closeEditModal() {
    setEditOpen(false);
    setInvoicePrepEditFlow(false);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setIsLoading(true);
      setNotFound(false);
      setData(null);
      try {
        if (!Number.isFinite(id)) throw new Error("Invalid order id");
        const res = await ordersApi.get(id);
        if (!alive) return;
        setData(res);
      } catch (err: any) {
        if (!alive) return;
        const status = err?.response?.status;
        if (status === 404) {
          setNotFound(true);
          setData(null);
        } else {
          toast.push("error", getErrorMessage(err));
        }
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, toast]);

  const images = useMemo(() => {
    const xs = (((data as any)?.image_urls as string[] | null | undefined) ?? []).filter(Boolean);
    if (xs.length) return xs;
    const legacy = (data as any)?.image_url;
    return legacy ? [legacy] : [];
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Order details</div>
          <div className="mt-1 text-sm text-black/60">
            {isLoading
              ? "Loading…"
              : notFound
                ? "Order not found"
                : data
                  ? `#${displayNumber ?? data.order_id}`
                  : "—"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => nav("/orders")}>
            Back to orders
          </Button>
          {canEditOrder && data && !isLoading && !notFound ? (
            <Button onClick={() => setEditOpen(true)}>Edit order</Button>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <Card>
          <div className="text-sm text-black/60">Loading order…</div>
        </Card>
      ) : notFound ? (
        <Card>
          <div className="text-sm font-semibold">Order not found</div>
          <div className="mt-1 text-sm text-black/60">This order may have been deleted.</div>
        </Card>
      ) : !data ? (
        <Card>
          <div className="text-sm text-black/60">No data.</div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-black/60">Order</div>
                  <div className="mt-1 text-xl font-bold tracking-tight">
                    #{displayNumber ?? data.order_id}
                  </div>
                  {(data as any).updated_by || (data as any).created_by ? (
                    <div className="mt-1 text-xs font-semibold text-black/50">
                      {(data as any).updated_by
                        ? `Updated by ${(data as any).updated_by}`
                        : `Done by ${(data as any).created_by}`}
                    </div>
                  ) : null}
                </div>
                <StatusBadge status={data.status} />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                  <div className="text-xs font-semibold text-black/60">Due date</div>
                  <div className="mt-1 text-sm font-semibold">
                    {data.due_date ? new Date(data.due_date).toLocaleDateString() : "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                  <div className="text-xs font-semibold text-black/60">Items</div>
                  <div className="mt-1 text-sm font-semibold">{data.items.length}</div>
                </div>
              </div>
            </Card>

            {auth.role !== "factory" && data.customer ? (
              <Card>
                <div className="text-sm font-semibold">Customer</div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-black/10 bg-white p-4">
                    <div className="text-xs font-semibold text-black/60">Name</div>
                    <div className="mt-1 text-sm font-semibold">{data.customer.name}</div>
                  </div>
                  <div className="rounded-2xl border border-black/10 bg-white p-4">
                    <div className="text-xs font-semibold text-black/60">Phone</div>
                    <div className="mt-1 text-sm font-semibold">{data.customer.phone ?? "—"}</div>
                  </div>
                  <div className="rounded-2xl border border-black/10 bg-white p-4">
                    <div className="text-xs font-semibold text-black/60">Address</div>
                    <div className="mt-1 text-sm font-semibold">{data.customer.address ?? "—"}</div>
                  </div>
                  <div className="rounded-2xl border border-black/10 bg-white p-4">
                    <div className="text-xs font-semibold text-black/60">Birthday</div>
                    <div className="mt-1 text-sm font-semibold">
                      {formatCustomerBirthday(data.customer.birth_day, data.customer.birth_month)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-black/10 bg-white p-4 md:col-span-2">
                    <div className="text-xs font-semibold text-black/60">Email</div>
                    <div className="mt-1 text-sm font-semibold">{data.customer.email ?? "—"}</div>
                  </div>
                </div>
              </Card>
            ) : null}

            {canIssueInvoice ? (
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Invoice</div>
                    <div className="mt-1 text-sm text-black/60">
                      {(data as any).invoice_id
                        ? "Open the invoice for this order."
                        : "No invoice on file. Create one from this order's totals and payment (e.g. after the previous invoice was removed)."}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(data as any).invoice_id ? (
                      <Button
                        variant="secondary"
                        onClick={() => nav(`/invoices/${(data as any).invoice_id}`)}
                      >
                        View invoice
                      </Button>
                    ) : (
                      <Button
                        isLoading={issuingInvoice}
                        onClick={() => {
                          if (!data) return;
                          setPreInvoicePromptOpen(true);
                        }}
                      >
                        Generate invoice
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ) : null}

            {canIssueInvoice ? (
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Order document</div>
                    <div className="mt-1 text-sm text-black/60">
                      {data.customer?.email?.trim()
                        ? `Download a PDF or email a copy to the customer (${data.customer.email}).`
                        : "Download a print-ready PDF of this order. Add a customer email to send by email."}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      isLoading={downloadingOrderPdf}
                      onClick={async () => {
                        if (!data) return;
                        try {
                          setDownloadingOrderPdf(true);
                          await ordersApi.download(data.order_id);
                          toast.push("success", "Order PDF downloaded.");
                        } catch (err) {
                          toast.push("error", getErrorMessage(err));
                        } finally {
                          setDownloadingOrderPdf(false);
                        }
                      }}
                    >
                      Download PDF
                    </Button>
                    {data.customer?.email?.trim() ? (
                      <Button
                        variant="secondary"
                        isLoading={sendingOrderEmail}
                        onClick={async () => {
                          if (!data) return;
                          try {
                            setSendingOrderEmail(true);
                            await ordersApi.sendEmail(data.order_id);
                            toast.push("success", "Order PDF emailed to customer.");
                          } catch (err) {
                            toast.push("error", getErrorMessage(err));
                          } finally {
                            setSendingOrderEmail(false);
                          }
                        }}
                      >
                        Email order (PDF)
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ) : null}

            {auth.role === "admin" || auth.role === "showroom" || auth.role === "finance" ? (
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Waybill</div>
                    <div className="mt-1 text-sm text-black/60">Create a delivery document for this order.</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      isLoading={creatingWaybill}
                      onClick={() => {
                        setWbDriverName("");
                        setWbDriverPhone("");
                        setWbVehiclePlate("");
                        setWaybillModalOpen(true);
                      }}
                    >
                      Create waybill
                    </Button>
                    <Button variant="secondary" onClick={() => nav("/waybills")}>
                      All waybills
                    </Button>
                  </div>
                </div>
              </Card>
            ) : null}

            <Card>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Pricing</div>
                  <div className="mt-1 text-sm text-black/60">
                    {canSeePricing ? "Totals and payment state" : "Pricing is hidden for your role."}
                  </div>
                </div>
                {auth.role === "admin" ? (
                  <Button
                    isLoading={paying}
                    onClick={async () => {
                      try {
                        setPaying(true);
                        await ordersApi.markFullyPaid(data.order_id);
                        const refreshed = await ordersApi.get(data.order_id);
                        setData(refreshed);
                        toast.push("success", "Marked as fully paid");
                      } catch (err) {
                        toast.push("error", getErrorMessage(err));
                      } finally {
                        setPaying(false);
                      }
                    }}
                  >
                    Mark as Fully Paid
                  </Button>
                ) : null}
              </div>

              {canSeePricing ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-black/10 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-black/60">Pricing</div>
                      <TaxInlineEditor
                        orderId={data.order_id}
                        canEdit={auth.role === "admin" || auth.role === "showroom"}
                        value={(data as any).tax_percent}
                        onSaved={async () => {
                          const refreshed = await ordersApi.get(data.order_id);
                          setData(refreshed);
                        }}
                      />
                    </div>
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <div className="text-black/60">Subtotal</div>
                        <div className="font-semibold">{formatMoney((data as any).total_price)}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-black/60">Discount</div>
                        <div className="font-semibold">-{formatMoney((data as any).discount_amount)}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-black/60">
                          {(data as any).tax_percent != null && (data as any).tax_percent !== ""
                            ? `Tax (${(data as any).tax_percent}%)`
                            : "Tax amount"}
                        </div>
                        <div className="font-semibold">{formatMoney((data as any).tax)}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-black/60">Paid</div>
                        <div className="font-semibold">{formatMoney((data as any).amount_paid)}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-black/60">Balance</div>
                        <div className="font-semibold">{formatMoney((data as any).balance)}</div>
                      </div>

                      <div className="mt-3 flex items-center justify-between rounded-xl bg-black px-4 py-2 text-white">
                        <div className="font-bold">Total</div>
                        <div className="font-bold">{formatMoney((data as any).total)}</div>
                      </div>

                      {discountLabel((data as any).discount_type) ? (
                        <div className="pt-2 text-xs font-semibold text-black/60">
                          Discount: {discountLabel((data as any).discount_type)} •{" "}
                          {discountValueText((data as any).discount_type, (data as any).discount_value) ?? "—"}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {auth.role === "admin" && ((data as any).created_by || (data as any).updated_by) ? (
                    <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                      <div className="text-xs font-semibold text-black/60">Admin metadata</div>
                      <div className="mt-2 text-sm text-black/70">
                        Created by: <span className="font-semibold text-black">{(data as any).created_by ?? "—"}</span>
                      </div>
                      <div className="mt-1 text-sm text-black/70">
                        Last updated by:{" "}
                        <span className="font-semibold text-black">{(data as any).updated_by ?? "—"}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 text-sm text-black/60">
                  Pricing and tax details are not shown for your role.
                </div>
              )}
            </Card>

            <Card>
              <div className="text-sm font-semibold">Items</div>
              <div className="mt-4 md:hidden space-y-2">
                {data.items.length === 0 ? (
                  <div className="text-sm text-black/60">No items.</div>
                ) : (
                  data.items.map((it) => {
                    const lt = (it as any).line_type ?? "item";
                    if (lt === "subheading") {
                      return (
                        <div
                          key={it.id}
                          className="rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-3 text-xs font-bold uppercase tracking-[0.08em] text-black"
                        >
                          {it.item_name}
                        </div>
                      );
                    }
                    const unit = canSeeItemPricing ? parseMoneyNumber(it.amount) : null;
                    const qty = typeof it.quantity === "number" ? it.quantity : Number(it.quantity);
                    const line = unit !== null && Number.isFinite(qty) ? unit * qty : null;
                    return (
                      <div key={it.id} className="rounded-2xl border border-black/10 bg-white p-4">
                        <div className="text-sm font-bold">{it.item_name}</div>
                        <div className="mt-1 text-sm text-black/70 break-words whitespace-normal">{it.description ?? "—"}</div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                            <div className="font-semibold text-black/55">Qty</div>
                            <div className="mt-0.5 font-bold tabular-nums">{it.quantity}</div>
                          </div>
                          {canSeeItemPricing ? (
                            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2">
                              <div className="font-semibold text-black/55">Unit</div>
                              <div className="mt-0.5 font-bold tabular-nums">{formatMoney(unit)}</div>
                            </div>
                          ) : (
                            <div />
                          )}
                          {canSeeItemPricing ? (
                            <div className="col-span-2 rounded-xl border border-black/10 bg-black/[0.02] p-2">
                              <div className="font-semibold text-black/55">Line total</div>
                              <div className="mt-0.5 font-bold tabular-nums">{formatMoney(line)}</div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-4 hidden md:block min-w-0 overflow-x-touch">
                <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-sm">
                  <colgroup>
                    {canSeeItemPricing ? (
                      <>
                        <col className="w-[24%]" />
                        <col className="w-[26%]" />
                        <col className="w-[10%]" />
                        <col className="w-[20%]" />
                        <col className="w-[20%]" />
                      </>
                    ) : (
                      <>
                        <col className="w-[28%]" />
                        <col className="w-[44%]" />
                        <col className="w-[28%]" />
                      </>
                    )}
                  </colgroup>
                  <thead className="text-black/60">
                    <tr>
                      <th className="border-b border-black/10 py-3 pl-3 pr-2 text-left font-semibold">Item name</th>
                      <th className="border-b border-l border-black/10 py-3 px-2 text-left font-semibold">Description</th>
                      <th className="border-b border-l border-black/10 py-3 px-2 text-right font-semibold">Qty</th>
                      {canSeeItemPricing ? (
                        <>
                          <th className="border-b border-l border-black/10 py-3 px-2 text-right font-semibold">Amount</th>
                          <th className="border-b border-l border-black/10 py-3 px-2 text-right font-semibold">Total</th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 ? (
                      <tr>
                        <td colSpan={canSeeItemPricing ? 5 : 3} className="py-6 text-black/60">
                          No items.
                        </td>
                      </tr>
                    ) : (
                      data.items.map((it) => {
                        const lt = (it as any).line_type ?? "item";
                        if (lt === "subheading") {
                          return (
                            <tr key={it.id} className="border-b border-black/10 bg-black/[0.02]">
                              <td
                                colSpan={canSeeItemPricing ? 5 : 3}
                                className="py-2.5 pl-3 pr-3 text-xs font-bold uppercase tracking-[0.08em] text-black"
                              >
                                {it.item_name}
                              </td>
                            </tr>
                          );
                        }
                        const unit = canSeeItemPricing ? parseMoneyNumber(it.amount) : null;
                        const qty = typeof it.quantity === "number" ? it.quantity : Number(it.quantity);
                        const line = unit !== null && Number.isFinite(qty) ? unit * qty : null;
                        return (
                          <tr key={it.id} className="border-b border-black/5">
                            <td className="border-b border-black/5 py-3 pl-3 pr-2 align-top font-semibold">
                              {it.item_name}
                            </td>
                            <td className="max-w-0 border-b border-l border-black/10 border-black/5 py-3 px-2 align-top break-words leading-snug text-black/70 whitespace-normal">
                              {it.description ?? "—"}
                            </td>
                            <td className="border-b border-l border-black/10 border-black/5 py-3 px-2 text-right align-top font-semibold tabular-nums whitespace-nowrap">
                              {it.quantity}
                            </td>
                            {canSeeItemPricing ? (
                              <>
                                <td className="border-b border-l border-black/10 border-black/5 py-3 px-2 text-right font-semibold tabular-nums whitespace-nowrap">
                                  {formatMoney(unit)}
                                </td>
                                <td className="border-b border-l border-black/10 border-black/5 py-3 px-2 text-right font-semibold tabular-nums whitespace-nowrap">
                                  {formatMoney(line)}
                                </td>
                              </>
                            ) : null}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card>
            <div className="text-sm font-semibold">Image</div>
            <div className="mt-3">
              {!((data as any).image_urls?.length) && !data.image_url ? (
                <div className="flex aspect-[4/3] items-center justify-center rounded-2xl border border-black/10 bg-black/[0.02] text-sm text-black/50">
                  No image uploaded
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {(((data as any).image_urls as string[] | null | undefined) ?? (data.image_url ? [data.image_url] : []))
                    .filter(Boolean)
                    .map((src, idx) => (
                      <button
                        key={`${src}-${idx}`}
                        type="button"
                        className="group relative block overflow-hidden rounded-2xl border border-black/10 bg-black/[0.02]"
                        onClick={() => {
                          setLightboxIndex(idx);
                          setLightboxOpen(true);
                        }}
                      >
                        <img
                          src={src}
                          alt={`Order #${data.order_id} image ${idx + 1}`}
                          className="aspect-[4/3] w-full object-cover"
                        />
                        <div className="pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100">
                          <div className="absolute inset-0 bg-black/5" />
                          <div className="absolute bottom-2 right-2 rounded-xl border border-black/10 bg-white px-2.5 py-1 text-[11px] font-semibold">
                            Zoom
                          </div>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      <Modal
        open={preInvoicePromptOpen}
        title="Generate invoice"
        onClose={() => setPreInvoicePromptOpen(false)}
      >
        <p className="text-sm text-black/70">
          Do you want to review and update order details before generating the invoice?
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setPreInvoicePromptOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!data) return;
              setPreInvoicePromptOpen(false);
              void runIssueInvoice(data.order_id, false);
            }}
            disabled={issuingInvoice}
          >
            No, generate now
          </Button>
          <Button
            onClick={() => {
              setPreInvoicePromptOpen(false);
              setInvoicePrepEditFlow(true);
              setEditOpen(true);
            }}
          >
            Yes, review first
          </Button>
        </div>
      </Modal>

      {data && canEditOrder ? (
        <EditOrderModal
          open={editOpen}
          orderId={data.order_id}
          initial={data}
          invoicePrepFlow={invoicePrepEditFlow}
          onClose={closeEditModal}
          onSaved={async (updated, fromInvoicePrep) => {
            setEditOpen(false);
            setInvoicePrepEditFlow(false);
            setData(updated);
            toast.push("success", "Order updated successfully");
            if (fromInvoicePrep) {
              try {
                setIssuingInvoice(true);
                const res = await invoicesApi.issueForOrder(updated.order_id, {
                  orderEditedBeforeInvoice: true
                });
                toast.push("success", res.message || "Invoice created");
                const refreshed = await ordersApi.get(updated.order_id);
                setData(refreshed);
                nav(`/invoices/${res.invoice_id}`);
              } catch (err) {
                toast.push("error", getErrorMessage(err));
              } finally {
                setIssuingInvoice(false);
              }
            }
          }}
        />
      ) : null}

      <Modal open={waybillModalOpen} title="Waybill — driver & vehicle" onClose={() => setWaybillModalOpen(false)}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              if (!data) return;
              const dn = wbDriverName.trim();
              const dp = wbDriverPhone.trim();
              const vp = wbVehiclePlate.trim();
              if (!dn || !dp || !vp) {
                toast.push("error", "Driver name, driver phone, and vehicle plate are required.");
                return;
              }
              try {
                setCreatingWaybill(true);
                const wb = await waybillApi.create({
                  order_id: data.order_id,
                  driver_name: dn,
                  driver_phone: dp,
                  vehicle_plate: vp
                });
                toast.push("success", "Waybill created.");
                setWaybillModalOpen(false);
                nav(`/waybills/${wb.id}`);
              } catch (err) {
                toast.push("error", getErrorMessage(err));
              } finally {
                setCreatingWaybill(false);
              }
            })();
          }}
        >
          <p className="text-sm text-black/70">
            These details are saved on the waybill and are required before print, download, or email.
          </p>
          <Input label="Driver name" value={wbDriverName} onChange={(e) => setWbDriverName(e.target.value)} required />
          <Input label="Driver phone" value={wbDriverPhone} onChange={(e) => setWbDriverPhone(e.target.value)} required />
          <Input
            label="Vehicle plate number"
            value={wbVehiclePlate}
            onChange={(e) => setWbVehiclePlate(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setWaybillModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={creatingWaybill}>
              Create waybill
            </Button>
          </div>
        </form>
      </Modal>

      <ImageLightbox
        open={lightboxOpen}
        title={data ? `Order #${displayNumber ?? data.order_id}` : "Image preview"}
        images={images}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}

function EditOrderModal({
  open,
  orderId,
  initial,
  invoicePrepFlow,
  onClose,
  onSaved
}: {
  open: boolean;
  orderId: number;
  initial: Details;
  invoicePrepFlow: boolean;
  onClose(): void;
  onSaved(updated: Details, fromInvoicePrep: boolean): Promise<void>;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<OrderStatus>(initial.status);
  const [dueDate, setDueDate] = useState(isoToDateInput(initial.due_date));
  const [totalPrice, setTotalPrice] = useState(
    initial.total_price != null ? String(initial.total_price) : ""
  );
  const [deposit, setDeposit] = useState(
    initial.amount_paid != null ? String(initial.amount_paid) : ""
  );
  const [tax, setTax] = useState(
    (initial as any).tax_percent != null ? String((initial as any).tax_percent) : ""
  );
  const [discountType, setDiscountType] = useState<"" | "fixed" | "percentage">(
    (initial as any).discount_type ?? ""
  );
  const [discountValue, setDiscountValue] = useState(
    (initial as any).discount_value != null ? String((initial as any).discount_value) : ""
  );
  type OrderLineEdit = {
    key: string;
    line_type: "item" | "subheading";
    item_name: string;
    description: string;
    quantity: string;
    amount: string;
  };
  function newItemRow(): OrderLineEdit {
    return {
      key: crypto.randomUUID(),
      line_type: "item",
      item_name: "",
      description: "",
      quantity: "1",
      amount: ""
    };
  }
  function newSubheadingRow(): OrderLineEdit {
    return { key: crypto.randomUUID(), line_type: "subheading", item_name: "", description: "", quantity: "", amount: "" };
  }
  const [items, setItems] = useState<OrderLineEdit[]>(
    initial.items.map((it) => ({
      key: crypto.randomUUID(),
      line_type: ((it as any).line_type ?? "item") as any,
      item_name: it.item_name,
      description: it.description ?? "",
      quantity: String(it.quantity ?? ""),
      amount: it.amount != null && it.amount !== "" ? String(it.amount) : ""
    }))
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setStatus(initial.status);
    setDueDate(isoToDateInput(initial.due_date));
    setTotalPrice(initial.total_price != null ? String(initial.total_price) : "");
    setDeposit(initial.amount_paid != null ? String(initial.amount_paid) : "");
    setTax((initial as any).tax_percent != null ? String((initial as any).tax_percent) : "");
    setDiscountType(((initial as any).discount_type ?? "") as any);
    setDiscountValue((initial as any).discount_value != null ? String((initial as any).discount_value) : "");
    setItems(
      initial.items.map((it) => ({
        key: crypto.randomUUID(),
        line_type: ((it as any).line_type ?? "item") as any,
        item_name: it.item_name,
        description: it.description ?? "",
        quantity: String(it.quantity ?? ""),
        amount: it.amount != null && it.amount !== "" ? String(it.amount) : ""
      }))
    );
    setErr({});
  }, [open, initial]);

  function validate() {
    const e: Record<string, string> = {};
    const payload: OrderCreateItem[] = [];
    items.forEach((it, idx) => {
      if (it.line_type === "subheading") {
        const name = it.item_name.trim();
        if (!name) e[`n${idx}`] = "Subheading required";
        if (name) payload.push({ line_type: "subheading", item_name: name, description: "", quantity: 0, amount: null });
        return;
      }
      const name = it.item_name.trim();
      const desc = it.description.trim();
      const qty = Number(it.quantity);
      const amt = parseMoneyInput(it.amount);
      if (!name) e[`n${idx}`] = "Item name required";
      if (!desc) e[`d${idx}`] = "Description required";
      if (!Number.isFinite(qty) || qty <= 0) e[`q${idx}`] = "Invalid quantity";
      if (amt === null || !Number.isFinite(amt) || amt < 0) {
        e[`a${idx}`] = isValidThousandsCommaNumber(it.amount) ? "Amount required (≥ 0)" : "Invalid comma formatting";
      }
      if (name && desc && Number.isFinite(qty) && qty > 0 && amt !== null && Number.isFinite(amt) && amt >= 0) {
        payload.push({ line_type: "item", item_name: name, description: desc, quantity: qty, amount: amt });
      }
    });
    if (payload.length === 0) e.items = "At least one valid item required";

    // Optional pricing fields
    if (totalPrice.trim() && !isValidThousandsCommaNumber(totalPrice)) e.totalPrice = "Invalid comma formatting";
    const tp = parseMoneyInput(totalPrice);
    if (totalPrice.trim() && (tp === null || !Number.isFinite(tp) || tp < 0)) e.totalPrice = e.totalPrice || "Total price must be >= 0";

    if (deposit.trim() && !isValidThousandsCommaNumber(deposit)) e.deposit = "Invalid comma formatting";
    const dp = parseMoneyInput(deposit);
    if (deposit.trim() && (dp === null || !Number.isFinite(dp) || dp < 0)) e.deposit = e.deposit || "Deposit must be >= 0";

    if (tax.trim() && !isValidThousandsCommaNumber(tax)) e.tax = "Invalid comma formatting";
    const tx = parseMoneyInput(tax);
    if (tax.trim() && (tx === null || !Number.isFinite(tx) || tx < 0)) e.tax = e.tax || "Tax % must be >= 0";
    if (tax.trim() && tx !== null && Number.isFinite(tx) && tx > 100) e.tax = "Tax % must be <= 100";

    if (discountType) {
      if (discountValue.trim() && !isValidThousandsCommaNumber(discountValue)) e.discountValue = "Invalid comma formatting";
      const dv = parseMoneyInput(discountValue);
      if (!discountValue.trim() || dv === null || !Number.isFinite(dv) || dv < 0) e.discountValue = "Enter a valid discount value";
      if (discountType === "percentage" && dv !== null && Number.isFinite(dv) && dv > 100) e.discountValue = "Percentage discount must be <= 100";
    } else if (discountValue.trim()) {
      e.discountType = "Select a discount type";
    }

    setErr(e);
    return { ok: Object.keys(e).length === 0, payload, errors: e };
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const { ok, payload, errors } = validate();
    if (!ok) {
      const first = Object.values(errors)[0];
      toast.push("error", typeof first === "string" ? first : "Please fix the highlighted fields.");
      return;
    }
    setBusy(true);
    try {
      const updated = await ordersApi.updateAdmin(orderId, {
        status,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        items: payload,
        total_price: totalPrice.trim() === "" ? null : Number(sanitizeMoneyInput(totalPrice)),
        amount_paid: deposit.trim() === "" ? null : Number(sanitizeMoneyInput(deposit)),
        discount_type: discountType || null,
        discount_value: discountType ? (discountValue.trim() === "" ? 0 : Number(sanitizeMoneyInput(discountValue))) : null,
        tax: tax.trim() === "" ? null : Number(sanitizeMoneyInput(tax)),
        ...(invoicePrepFlow ? { update_context: "before_invoice" as const } : {})
      });
      await onSaved(updated, invoicePrepFlow);
    } catch (er) {
      toast.push("error", getErrorMessage(er));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Edit order" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={submit}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" && (ev.target as HTMLElement).tagName !== "TEXTAREA") {
            ev.preventDefault();
          }
        }}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block">
            <div className="mb-1 text-sm font-medium">Status</div>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus)}
            >
              <option value="pending">pending</option>
              <option value="in_progress">in_progress</option>
              <option value="completed">completed</option>
              <option value="delivered">delivered</option>
            </select>
          </label>
          <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>

        <div>
          <div className="text-sm font-semibold">Items</div>
          <div className="mt-2 space-y-3">
            {items.map((it, idx) => (
              <Fragment key={it.key}>
                <div
                  className={[
                    "grid grid-cols-1 gap-2 md:items-end",
                    it.line_type === "subheading" ? "md:grid-cols-[1fr_auto]" : "md:grid-cols-[1fr_1fr_88px_120px_auto]"
                  ].join(" ")}
                >
                  <Input
                    label={idx === 0 ? "Item name" : undefined}
                    value={it.item_name}
                    onChange={(e) =>
                      setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, item_name: e.target.value } : x)))
                    }
                    error={err[`n${idx}`]}
                  />
                  {it.line_type !== "subheading" ? (
                    <label className="block">
                      {idx === 0 ? <div className="mb-1 text-sm font-medium">Description</div> : null}
                      <textarea
                        className={[
                          "min-h-[72px] w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-black/40",
                          err[`d${idx}`] ? "border-black/30" : ""
                        ].join(" ")}
                        value={it.description}
                        onChange={(e) =>
                          setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))
                        }
                      />
                      {err[`d${idx}`] ? <div className="mt-1 text-xs text-black/70">{err[`d${idx}`]}</div> : null}
                    </label>
                  ) : null}
                  {it.line_type !== "subheading" ? (
                    <Input
                      label={idx === 0 ? "Qty" : undefined}
                      value={it.quantity}
                      onChange={(e) =>
                        setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))
                      }
                      inputMode="numeric"
                      error={err[`q${idx}`]}
                    />
                  ) : null}
                  {it.line_type !== "subheading" ? (
                    <Input
                      label={idx === 0 ? "Amount" : undefined}
                      value={it.amount}
                      onChange={(e) =>
                        setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))
                      }
                      inputMode="decimal"
                      placeholder="0.00"
                      error={err[`a${idx}`]}
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={items.length <= 1}
                    onClick={() => setItems((xs) => xs.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </Button>
                </div>
                {it.line_type === "subheading" ? (
                  <div className="-mt-1 flex flex-wrap gap-2 pl-0.5">
                    <Button type="button" variant="secondary" onClick={() => setItems((xs) => {
                      const row = newItemRow();
                      return [...xs.slice(0, idx + 1), row, ...xs.slice(idx + 1)];
                    })}>
                      Add line
                    </Button>
                  </div>
                ) : null}
              </Fragment>
            ))}
          </div>
          {err.items ? <div className="mt-2 text-xs text-black/70">{err.items}</div> : null}
          <div className="mt-2">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => setItems((xs) => [...xs, newItemRow()])}>
                Add item
              </Button>
              <Button type="button" variant="secondary" onClick={() => setItems((xs) => [...xs, newSubheadingRow()])}>
                Add subheading
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input
            label="Total price (optional)"
            value={totalPrice}
            onChange={(e) => setTotalPrice(e.target.value)}
            inputMode="decimal"
            error={err.totalPrice}
          />
          <Input
            label="Deposit made (optional)"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            inputMode="decimal"
            error={err.deposit}
          />
          <Input
            label="Tax % (optional)"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 7.5 for 7.5% VAT"
            error={err.tax}
          />
          <label className="block">
            <div className="mb-1 text-sm font-medium">Discount type (optional)</div>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as any)}
            >
              <option value="">No discount</option>
              <option value="fixed">Fixed</option>
              <option value="percentage">Percentage</option>
            </select>
            {err.discountType ? <div className="mt-1 text-xs text-black/70">{err.discountType}</div> : null}
          </label>
          <Input
            label="Discount value (optional)"
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            inputMode="decimal"
            placeholder={discountType === "percentage" ? "e.g. 10" : "e.g. 500.00"}
            error={err.discountValue}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TaxInlineEditor({
  orderId,
  value,
  canEdit,
  onSaved
}: {
  orderId: number;
  value: any;
  canEdit: boolean;
  onSaved(): Promise<void>;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tax, setTax] = useState(value != null ? String(value) : "");

  useEffect(() => {
    setTax(value != null ? String(value) : "");
  }, [value]);

  if (!canEdit) return null;

  return open ? (
    <div className="flex items-center gap-2">
      <input
        className="w-[140px] rounded-xl border border-black/15 bg-white px-3 py-1.5 text-sm shadow-sm"
        value={tax}
        onChange={(e) => setTax(e.target.value)}
        inputMode="decimal"
        placeholder="e.g. 7.5"
      />
      <button
        className="rounded-xl border border-black/15 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-black/5 disabled:opacity-60"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await ordersApi.updatePricing(orderId, {
              tax: tax.trim() === "" ? null : Number(sanitizeMoneyInput(tax))
            });
            await onSaved();
            toast.push("success", "Tax updated");
            setOpen(false);
          } catch (err) {
            toast.push("error", getErrorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
        type="button"
      >
        Save
      </button>
      <button
        className="rounded-xl px-2 py-1.5 text-sm font-semibold text-black/60 hover:bg-black/5"
        onClick={() => {
          setTax(value != null ? String(value) : "");
          setOpen(false);
        }}
        type="button"
      >
        Cancel
      </button>
    </div>
  ) : (
    <button
      className="rounded-xl px-2 py-1 text-xs font-semibold text-black/60 hover:bg-black/5"
      type="button"
      onClick={() => setOpen(true)}
    >
      Edit tax %
    </button>
  );
}

