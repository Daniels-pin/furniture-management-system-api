import type { Customer, OrderItem } from "../../types/api";
import { APP_NAME, COMPANY_CONTACT } from "../../config/app";
import { env } from "../../env";
import { DocumentPaymentFooter } from "../DocumentPaymentFooter";
import { formatMoney, parseMoneyNumber } from "../../utils/money";

/** Shape returned by GET /orders/{id} (used for screen + PDF). */
export type OrderDocumentData = {
  order_id: number;
  created_at: string;
  due_date?: string | null;
  customer: Customer | null;
  items: OrderItem[];
  total_price?: string | number | null;
  discount_amount?: string | number | null;
  tax_percent?: string | number | null;
  tax?: string | number | null;
  amount_paid?: string | number | null;
  balance?: string | number | null;
  total?: string | number | null;
};

type Props = { data: OrderDocumentData; maskCustomer: boolean };

export function OrderDocumentBody({ data, maskCustomer }: Props) {
  const c = data.customer;
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
                <span className="text-xs font-bold tracking-[0.28em]">ORDER</span>
              </div>
              <div className="mt-3 text-sm text-black">
                <div>
                  <span className="text-black/60">Order ID:</span>{" "}
                  <span className="font-semibold">#{data.order_id}</span>
                </div>
                <div className="mt-1">
                  <span className="text-black/60">Date:</span>{" "}
                  <span className="font-semibold">
                    {new Date(data.created_at).toLocaleDateString(undefined, { dateStyle: "long" })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-5 border-b border-black/10 pb-3 print:mt-4 print:border-black print:pb-2">
          <div className="grid grid-cols-2 items-start gap-x-3 gap-y-0 text-sm sm:gap-x-6 md:gap-x-10 print:gap-x-4">
            <div className="min-w-0">
              <div className="font-bold text-black">From:</div>
              <div className="mt-1.5 space-y-0.5 break-words leading-snug text-black/80">
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
              <div className="font-bold text-black">Customer:</div>
              <div className="mt-1.5 space-y-0.5 break-words leading-snug text-black/80">
                <div className="font-semibold text-black">{maskCustomer ? "—" : c?.name}</div>
                <div>{maskCustomer ? "—" : c?.address ?? "—"}</div>
                <div>{maskCustomer ? "—" : c?.phone ?? "—"}</div>
                <div>{maskCustomer ? "—" : c?.email ?? "—"}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 print:mt-5">
          <div className="mt-3 min-w-0 overflow-x-touch print:overflow-visible">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-sm print:min-w-0">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[46%]" />
                <col className="w-[8%]" />
                <col className="w-[11%]" />
                <col className="w-[11%]" />
              </colgroup>
              <thead>
                <tr className="bg-black/[0.03] text-black">
                  <th className="py-2 pl-3 pr-3 font-semibold">Item</th>
                  <th className="py-2 pr-3 font-semibold">Description</th>
                  <th className="py-2 pr-3 text-right font-semibold">Qty</th>
                  <th className="py-2 pr-3 text-right font-semibold">Amount</th>
                  <th className="py-2 pr-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => {
                  const lt = (it as any).line_type ?? "item";
                  if (lt === "subheading") {
                    return (
                      <tr key={it.id} className="border-b border-black/15 bg-black/[0.02] print:border-black/40">
                        <td colSpan={5} className="py-2.5 pl-3 pr-3 font-bold tracking-[0.08em] text-black uppercase">
                          {it.item_name}
                        </td>
                      </tr>
                    );
                  }
                  const unitNum = parseMoneyNumber(it.amount);
                  const qtyNum = Number(it.quantity);
                  const line = unitNum !== null && Number.isFinite(qtyNum) ? unitNum * qtyNum : null;
                  return (
                    <tr key={it.id} className="border-b border-black/15 print:border-black/40">
                      <td className="py-3 pl-3 pr-3 font-semibold text-black align-top">{it.item_name}</td>
                      <td className="py-3 pr-3 text-black align-top whitespace-normal break-words leading-snug">
                        {it.description ?? "—"}
                      </td>
                      <td className="py-3 pr-3 text-right font-semibold text-black align-top">{it.quantity}</td>
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
              <div className="flex items-center justify-between">
                <div className="text-black/70">Subtotal:</div>
                <div className="font-semibold text-black">{formatMoney(data.total_price)}</div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-black/70">Discount</div>
                <div className="font-semibold text-black">-{formatMoney(data.discount_amount)}</div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-black/70">
                  {data.tax_percent != null && data.tax_percent !== "" ? `Tax (${data.tax_percent}%)` : "Tax"}
                </div>
                <div className="font-semibold text-black">{formatMoney(data.tax)}</div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-black/70">Paid:</div>
                <div className="font-semibold text-black">{formatMoney(data.amount_paid)}</div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-black/70">Balance:</div>
                <div className="font-semibold text-black">{formatMoney(data.balance)}</div>
              </div>

              <div className="mt-3 flex items-center justify-between bg-black px-4 py-2 text-white">
                <div className="text-base font-bold">Total</div>
                <div className="text-base font-bold">{formatMoney(data.total)}</div>
              </div>
            </div>
          </div>

          <div className="mt-6 text-sm text-black/80">
            <span className="text-black/70">Due date:</span>{" "}
            <span className="font-semibold text-black">
              {data.due_date
                ? new Date(data.due_date).toLocaleDateString(undefined, { dateStyle: "long" })
                : "—"}
            </span>
          </div>

          <div className="mt-6 border-t border-black/10 pt-3 text-sm text-black/80 print:border-black">
            <div className="font-bold text-black">Note:</div>
            <div className="mt-1">
              This document summarizes your order. For tax invoice, refer to your invoice from {APP_NAME}.
            </div>
          </div>
          <DocumentPaymentFooter />
        </section>
      </article>
    </div>
  );
}
