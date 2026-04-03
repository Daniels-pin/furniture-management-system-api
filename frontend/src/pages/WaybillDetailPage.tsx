import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { waybillApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import type { WaybillDetail } from "../types/api";
import { formatMoney, parseMoneyNumber } from "../utils/money";
import { APP_NAME, COMPANY_CONTACT } from "../config/app";

function deliveryBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "delivered")
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">Delivered</span>;
  if (s === "shipped")
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Shipped</span>;
  return <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/80">Pending</span>;
}

export function WaybillDetailPage() {
  const { waybillId } = useParams();
  const id = Number(waybillId);
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<WaybillDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [statusDraft, setStatusDraft] = useState<"pending" | "shipped" | "delivered">("pending");
  const viewLogged = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        if (!Number.isFinite(id)) throw new Error("bad id");
        const res = await waybillApi.get(id);
        if (!alive) return;
        setData(res);
        const s = (res.delivery_status || "pending").toLowerCase();
        if (s === "shipped" || s === "delivered" || s === "pending") setStatusDraft(s);
        if (!viewLogged.current) {
          viewLogged.current = true;
          void waybillApi.recordView(id).catch(() => {});
        }
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

  const canDelete = auth.role === "admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end print:hidden">
        <div>
          <div className="text-2xl font-bold tracking-tight">Waybill</div>
          <div className="mt-1 text-sm text-black/60">
            {loading ? "Loading…" : data ? `#${data.waybill_number}` : notFound ? "Not found" : "—"}
          </div>
          {data?.created_by ? (
            <div className="mt-1 text-xs font-semibold text-black/50">Created by {data.created_by}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => nav("/waybills")}>
            Back
          </Button>
          {data ? (
            <>
              <label className="flex items-center gap-2 text-sm font-semibold text-black/70">
                <span>Status</span>
                <select
                  className="rounded-xl border border-black/15 bg-white px-2 py-2 text-sm font-semibold"
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value as typeof statusDraft)}
                >
                  <option value="pending">Pending</option>
                  <option value="shipped">Shipped</option>
                  <option value="delivered">Delivered</option>
                </select>
              </label>
              <Button
                variant="secondary"
                isLoading={acting}
                onClick={async () => {
                  if (!data || statusDraft === (data.delivery_status || "").toLowerCase()) return;
                  try {
                    setActing(true);
                    const updated = await waybillApi.updateStatus(id, statusDraft);
                    setData(updated);
                    const s = (updated.delivery_status || "pending").toLowerCase();
                    if (s === "shipped" || s === "delivered" || s === "pending") setStatusDraft(s);
                    toast.push("success", "Status updated.");
                  } catch (e) {
                    toast.push("error", getErrorMessage(e));
                  } finally {
                    setActing(false);
                  }
                }}
              >
                Save status
              </Button>
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  void (async () => {
                    try {
                      if (Number.isFinite(id)) await waybillApi.recordPrint(id);
                    } catch {
                      /* best-effort */
                    }
                    window.print();
                  })();
                }}
              >
                Print
              </Button>
              <Button
                variant="secondary"
                type="button"
                isLoading={acting}
                onClick={() => {
                  void (async () => {
                    try {
                      setActing(true);
                      await waybillApi.download(id);
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
              <Button
                variant="secondary"
                isLoading={sending}
                onClick={async () => {
                  try {
                    setSending(true);
                    const res = await waybillApi.sendEmail(data.id);
                    toast.push("success", res.message || "Sent");
                  } catch (e) {
                    toast.push("error", getErrorMessage(e));
                  } finally {
                    setSending(false);
                  }
                }}
              >
                Send email
              </Button>
              <Button variant="secondary" onClick={() => nav(`/orders/${data.order_id}`)}>
                View order
              </Button>
              {canDelete ? (
                <Button
                  variant="secondary"
                  className="border-red-600 text-red-700 hover:bg-red-50"
                  isLoading={acting}
                  onClick={async () => {
                    if (!window.confirm("Delete this waybill permanently?")) return;
                    try {
                      setActing(true);
                      await waybillApi.delete(id);
                      toast.push("success", "Waybill deleted.");
                      nav("/waybills");
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
            </>
          ) : null}
        </div>
      </div>

      {loading ? (
        <Card className="print:hidden">
          <div className="text-sm text-black/60">Loading…</div>
        </Card>
      ) : notFound || !data ? (
        <Card className="print:hidden">
          <div className="text-sm font-semibold">Waybill not found</div>
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
                    <span className="text-xs font-bold tracking-[0.2em]">WAYBILL</span>
                  </div>
                  <div className="mt-3 text-sm text-black">
                    <div>
                      <span className="text-black/60">Waybill number:</span>{" "}
                      <span className="font-semibold">#{data.waybill_number}</span>
                    </div>
                    <div className="mt-1">
                      <span className="text-black/60">Date:</span>{" "}
                      <span className="font-semibold">
                        {new Date(data.created_at).toLocaleDateString(undefined, { dateStyle: "long" })}
                      </span>
                    </div>
                    <div className="mt-1 print:hidden">{deliveryBadge(data.delivery_status)}</div>
                  </div>
                </div>
              </div>
            </header>

            <div className="mt-4 flex flex-wrap justify-between gap-4 border-b border-black/5 pb-4 text-sm print:hidden">
              <div>
                <span className="font-semibold text-black/60">Order</span>
                <div className="mt-1 font-semibold">#{String(data.order_id).padStart(3, "0")}</div>
              </div>
              <div className="text-right">
                <span className="font-semibold text-black/60">Delivery</span>
                <div className="mt-1 capitalize font-semibold">{data.delivery_status}</div>
              </div>
            </div>

            <section className="mt-6 border-b border-black/10 pb-4 print:mt-5 print:border-black print:pb-3">
              <div className="grid grid-cols-1 gap-6 text-sm md:grid-cols-2">
                <div>
                  <div className="font-bold text-black">Ship from:</div>
                  <div className="mt-2 space-y-1 text-black/80">
                    <div className="font-semibold text-black">{APP_NAME}</div>
                    {COMPANY_CONTACT.addresses.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                    {COMPANY_CONTACT.phones.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                    <div>{COMPANY_CONTACT.email}</div>
                  </div>
                </div>
                <div>
                  <div className="font-bold text-black">Ship to:</div>
                  <div className="mt-2 space-y-1 text-black/80">
                    <div className="font-semibold text-black">{data.customer_name}</div>
                    <div>{data.address ?? "—"}</div>
                    <div>{data.phone ?? "—"}</div>
                    <div>{data.email ?? "—"}</div>
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
                      <th className="py-2 pr-3 text-right font-semibold">Qty</th>
                      <th className="py-2 pr-3 text-right font-semibold">Unit</th>
                      <th className="py-2 pr-3 text-right font-semibold">Line</th>
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

            <section className="mt-6 border-t border-black/10 pt-3 text-sm text-black/80 print:border-black">
              <div className="font-bold text-black">Note:</div>
              <div className="mt-1">This waybill documents goods for delivery. It is not a tax invoice.</div>
            </section>
          </article>
        </div>
      )}
    </div>
  );
}
