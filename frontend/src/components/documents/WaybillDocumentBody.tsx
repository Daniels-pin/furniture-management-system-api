import type { WaybillDetail } from "../../types/api";
import { APP_NAME, COMPANY_CONTACT } from "../../config/app";
import { env } from "../../env";

function deliveryBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "delivered")
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">Delivered</span>;
  if (s === "shipped")
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Shipped</span>;
  return <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/80">Pending</span>;
}

type Props = { data: WaybillDetail };

export function WaybillDocumentBody({ data }: Props) {
  return (
    <div className="invoice-print-area">
      <article className="rounded-3xl border border-black/10 bg-white p-6 shadow-soft print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="border-b border-black/10 pb-4 print:border-black print:pb-3">
          <div className="flex items-center justify-between gap-6">
            <div className="flex flex-col items-center gap-1">
              <img
                src={env.logoUrl || "/logo.png"}
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
          <div className="grid grid-cols-2 items-start gap-x-3 gap-y-0 text-sm sm:gap-x-6 md:gap-x-10 print:gap-x-4">
            <div className="min-w-0">
              <div className="font-bold text-black">Ship from:</div>
              <div className="mt-2 space-y-1 break-words text-black/80">
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
            <div className="min-w-0">
              <div className="font-bold text-black">Ship to:</div>
              <div className="mt-2 space-y-1 break-words text-black/80">
                <div className="font-semibold text-black">{data.customer_name}</div>
                <div>{data.address ?? "—"}</div>
                <div>{data.phone ?? "—"}</div>
                <div>{data.email ?? "—"}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-sm print:mt-4 print:border-black print:bg-transparent">
          <div className="font-bold text-black">Driver &amp; vehicle</div>
          <div className="mt-2 space-y-1 text-black/80">
            <div>
              <span className="text-black/60">Driver name:</span>{" "}
              <span className="font-semibold text-black">{data.driver_name?.trim() || "—"}</span>
            </div>
            <div>
              <span className="text-black/60">Driver phone:</span>{" "}
              <span className="font-semibold text-black">{data.driver_phone?.trim() || "—"}</span>
            </div>
            <div>
              <span className="text-black/60">Vehicle plate:</span>{" "}
              <span className="font-semibold text-black">{data.vehicle_plate?.trim() || "—"}</span>
            </div>
          </div>
        </section>

        <section className="mt-6 print:mt-5">
          <div className="mt-3 min-w-0 overflow-x-touch print:overflow-visible">
            <table className="w-full min-w-[420px] table-fixed border-collapse text-left text-sm print:min-w-0">
              <colgroup>
                <col className="w-[26%]" />
                <col />
                <col className="w-[5rem]" />
              </colgroup>
              <thead>
                <tr className="bg-black/[0.03] text-black">
                  <th className="py-2 pl-3 pr-3 font-semibold">Item</th>
                  <th className="py-2 pr-3 font-semibold">Description</th>
                  <th className="py-2 px-2 sm:px-3 text-right font-semibold">Qty</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.id} className="border-b border-black/15 print:border-black/40">
                    <td className="align-top py-3 pl-3 pr-3 font-semibold text-black">{it.item_name}</td>
                    <td className="align-top py-3 pr-3 text-black break-words">{it.description ?? "—"}</td>
                    <td className="align-top whitespace-nowrap py-3 px-2 sm:px-3 text-right font-semibold text-black tabular-nums overflow-hidden">
                      {it.quantity}
                    </td>
                  </tr>
                ))}
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
  );
}
