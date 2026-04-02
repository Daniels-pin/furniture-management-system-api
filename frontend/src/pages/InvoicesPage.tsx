import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoicesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import type { InvoiceListItem } from "../types/api";
import { formatMoney } from "../utils/money";

function invoiceStatusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "paid") return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Paid</span>;
  if (s === "partial") return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Partial</span>;
  return <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/70">Unpaid</span>;
}

export function InvoicesPage() {
  const toast = useToast();
  const auth = useAuth();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<InvoiceListItem[]>([]);

  async function load() {
    setLoading(true);
    try {
      const data = await invoicesApi.list();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Invoices</div>
          <div className="mt-1 text-sm text-black/60">Auto-generated from orders.</div>
        </div>
        <Button variant="secondary" onClick={() => void load()} isLoading={loading}>
          Refresh
        </Button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="text-black/60">
              <tr className="border-b border-black/10">
                <th className="py-3 pr-4 font-semibold">Invoice</th>
                <th className="py-3 pr-4 font-semibold">Order</th>
                {auth.role !== "manager" ? <th className="py-3 pr-4 font-semibold">Customer</th> : null}
                <th className="py-3 pr-4 font-semibold">Status</th>
                <th className="py-3 pr-4 font-semibold">Total</th>
                <th className="py-3 pr-0 font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={auth.role !== "manager" ? 6 : 5} className="py-6 text-black/60">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={auth.role !== "manager" ? 6 : 5} className="py-6 text-black/60">
                    No invoices yet.
                  </td>
                </tr>
              ) : (
                rows.map((inv) => {
                  return (
                    <tr
                      key={inv.id}
                      className="cursor-pointer border-b border-black/5 transition hover:bg-black/[0.02]"
                      onClick={() => nav(`/invoices/${inv.id}`)}
                    >
                      <td className="py-3 pr-4 font-semibold">#{inv.invoice_number}</td>
                      <td className="py-3 pr-4 text-black/70">
                        Order #{String(inv.order_id).padStart(3, "0")}
                      </td>
                      {auth.role !== "manager" ? (
                        <td className="py-3 pr-4">{inv.customer?.name ?? "—"}</td>
                      ) : null}
                      <td className="py-3 pr-4">{invoiceStatusBadge(inv.status)}</td>
                      <td className="py-3 pr-4">{formatMoney(inv.total_price)}</td>
                      <td className="py-3 pr-0">{formatMoney(inv.balance)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
