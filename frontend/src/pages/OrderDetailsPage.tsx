import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { StatusBadge } from "../components/ui/StatusBadge";
import { ordersApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { formatMoney } from "../utils/money";

type Details = Awaited<ReturnType<typeof ordersApi.get>>;

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
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setIsLoading(true);
      setNotFound(false);
      setData(null);
      setImgLoaded(false);
      setImgError(false);
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
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => nav("/orders")}>
            Back to orders
          </Button>
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

            {auth.role !== "manager" && data.customer ? (
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
                </div>
              </Card>
            ) : null}

            {auth.role !== "manager" ? (
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Pricing</div>
                    <div className="mt-1 text-sm text-black/60">
                      {auth.role === "admin" || auth.role === "showroom"
                        ? "Totals and payment state"
                        : "—"}
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

                {auth.role === "admin" || auth.role === "showroom" ? (
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                      <div className="text-xs font-semibold text-black/60">Total price</div>
                      <div className="mt-1 text-sm font-semibold">{formatMoney((data as any).total_price)}</div>
                    </div>
                    <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                      <div className="text-xs font-semibold text-black/60">Amount paid</div>
                      <div className="mt-1 text-sm font-semibold">{formatMoney((data as any).amount_paid)}</div>
                    </div>
                    <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                      <div className="text-xs font-semibold text-black/60">Balance remaining</div>
                      <div className="mt-1 text-sm font-semibold">{formatMoney((data as any).balance)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-black/60">Pricing is hidden for your role.</div>
                )}
              </Card>
            ) : null}

            <Card>
              <div className="text-sm font-semibold">Items</div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-black/60">
                    <tr className="border-b border-black/10">
                      <th className="py-3 pr-4 font-semibold">Item name</th>
                      <th className="py-3 pr-4 font-semibold">Description</th>
                      <th className="py-3 pr-0 text-right font-semibold">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-6 text-black/60">
                          No items.
                        </td>
                      </tr>
                    ) : (
                      data.items.map((it) => (
                        <tr key={it.id} className="border-b border-black/5">
                          <td className="py-3 pr-4 font-semibold">{it.item_name}</td>
                          <td className="py-3 pr-4 text-black/70">{it.description ?? "—"}</td>
                          <td className="py-3 pr-0 text-right font-semibold">{it.quantity}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card>
            <div className="text-sm font-semibold">Image</div>
            <div className="mt-3">
              {!data.image_url ? (
                <div className="flex aspect-[4/3] items-center justify-center rounded-2xl border border-black/10 bg-black/[0.02] text-sm text-black/50">
                  No image uploaded
                </div>
              ) : (
                <button
                  type="button"
                  className="group relative block w-full overflow-hidden rounded-2xl border border-black/10 bg-black/[0.02]"
                  onClick={() => setZoomOpen(true)}
                >
                  <img
                    src={data.image_url}
                    alt={`Order #${data.order_id}`}
                    className="h-auto w-full object-contain"
                    onLoad={() => setImgLoaded(true)}
                    onError={() => setImgError(true)}
                  />
                  {!imgLoaded && !imgError ? (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-black/50">
                      Loading image…
                    </div>
                  ) : null}
                  {imgError ? (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-black/50">
                      Failed to load image
                    </div>
                  ) : null}
                  <div className="pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100">
                    <div className="absolute inset-0 bg-black/5" />
                    <div className="absolute bottom-3 right-3 rounded-xl border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold">
                      Click to zoom
                    </div>
                  </div>
                </button>
              )}
            </div>
          </Card>
        </div>
      )}

      {zoomOpen && data?.image_url ? (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-black/60" onClick={() => setZoomOpen(false)} />
          <div className="relative mx-auto mt-10 w-[min(1100px,calc(100vw-2rem))]">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black shadow-soft">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="text-sm font-semibold text-white/80">Image preview</div>
                <button
                  className="rounded-xl px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/10"
                  onClick={() => setZoomOpen(false)}
                >
                  Close
                </button>
              </div>
              <img src={data.image_url} alt="Order image preview" className="w-full object-contain" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

