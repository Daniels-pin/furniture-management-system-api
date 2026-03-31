import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui/Card";
import { customersApi, ordersApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";

export function DashboardPage() {
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [counts, setCounts] = useState({ orders: 0, customers: 0 });

  const items = useMemo(
    () => [
      { label: "Orders", value: counts.orders },
      { label: "Customers", value: counts.customers }
    ],
    [counts]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      setIsLoading(true);
      try {
        const [orders, customers] = await Promise.all([ordersApi.list(), customersApi.list()]);
        if (!alive) return;
        setCounts({
          orders: Array.isArray(orders) ? orders.length : 0,
          customers: Array.isArray(customers) ? customers.length : 0
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

