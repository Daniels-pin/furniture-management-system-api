import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui/Card";
import { customersApi, ordersApi, productsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";

export function DashboardPage() {
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [counts, setCounts] = useState({ orders: 0, customers: 0, products: 0 });

  const items = useMemo(
    () => [
      { label: "Orders", value: counts.orders },
      { label: "Customers", value: counts.customers },
      { label: "Products", value: counts.products }
    ],
    [counts]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      setIsLoading(true);
      try {
        const [orders, customers, products] = await Promise.all([
          ordersApi.list(),
          customersApi.list(),
          productsApi.list()
        ]);
        if (!alive) return;
        setCounts({
          orders: Array.isArray(orders) ? orders.length : 0,
          customers: Array.isArray(customers) ? customers.length : 0,
          products: Array.isArray(products) ? products.length : 0
        });
      } catch (err) {
        toast.push("error", getErrorMessage(err));
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-bold tracking-tight">Dashboard</div>
        <div className="mt-1 text-sm text-black/60">Overview of your system.</div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {items.map((x) => (
          <Card key={x.label}>
            <div className="text-sm font-semibold text-black/60">{x.label}</div>
            <div className="mt-2 text-4xl font-bold tracking-tight">
              {isLoading ? <span className="text-black/20">—</span> : x.value}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

