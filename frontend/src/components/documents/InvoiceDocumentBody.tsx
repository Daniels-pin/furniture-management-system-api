import type { InvoiceDetail } from "../../types/api";
import { APP_NAME, COMPANY_CONTACT } from "../../config/app";
import { env } from "../../env";
import { DocumentPaymentFooter } from "../DocumentPaymentFooter";
import { formatMoney, parseMoneyNumber } from "../../utils/money";

type Props = {
  data: InvoiceDetail;
  maskCustomer: boolean;
};

export function InvoiceDocumentBody({ data, maskCustomer }: Props) {
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
                <div className="font-semibold text-black">{maskCustomer ? "—" : data.customer?.name}</div>
                <div>{maskCustomer ? "—" : data.customer?.address ?? "—"}</div>
                <div>{maskCustomer ? "—" : data.customer?.phone ?? "—"}</div>
                <div>{maskCustomer ? "—" : data.customer?.email ?? "—"}</div>
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
                  const line = unitNum !== null && Number.isFinite(qtyNum) ? unitNum * qtyNum : null;
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
                const allResolved = data.items.length > 0 && data.items.every((x) => parseMoneyNumber(x.amount) !== null);
                const subtotalToShow = allResolved ? lineSum : (data as { total_price?: unknown }).total_price;
                return (
                  <div className="flex items-center justify-between">
                    <div className="text-black/70">Subtotal:</div>
                    <div className="font-semibold text-black">{formatMoney(subtotalToShow)}</div>
                  </div>
                );
              })()}
              <div className="flex items-center justify-between">
                <div className="text-black/70">Discount</div>
                <div className="font-semibold text-black">-{formatMoney((data as any).discount_amount)}</div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-black/70">
                  {(data as any).tax_percent != null && (data as any).tax_percent !== ""
                    ? `Tax (${(data as any).tax_percent}%)`
                    : "Tax"}
                </div>
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
          <DocumentPaymentFooter />
        </section>
      </article>
    </div>
  );
}
