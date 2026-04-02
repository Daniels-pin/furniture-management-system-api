import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { StatusBadge } from "../components/ui/StatusBadge";
import { ordersApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { formatMoney } from "../utils/money";
import type { OrderCreateItem, OrderStatus } from "../types/api";

type Details = Awaited<ReturnType<typeof ordersApi.get>>;

function isoToDateInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
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
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const canEditOrder = auth.role === "admin";

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
                  <div className="rounded-2xl border border-black/10 bg-white p-4 md:col-span-3">
                    <div className="text-xs font-semibold text-black/60">Email</div>
                    <div className="mt-1 text-sm font-semibold">{data.customer.email ?? "—"}</div>
                  </div>
                </div>
              </Card>
            ) : null}

            {auth.role !== "factory" ? (
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
                  <div className="mt-4 space-y-3">
                    <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                      <div className="text-xs font-semibold text-black/60">Total price</div>
                      <div className="mt-1 text-sm font-semibold">{formatMoney((data as any).total_price)}</div>
                    </div>

                    {discountLabel((data as any).discount_type) ? (
                      <div className="rounded-2xl border border-black/10 bg-white p-4">
                        <div className="text-xs font-semibold text-black/60">Discount</div>
                        <div className="mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
                          <div>
                            <div className="text-xs font-semibold text-black/50">Type</div>
                            <div className="mt-0.5 font-semibold">{discountLabel((data as any).discount_type)}</div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-black/50">Value</div>
                            <div className="mt-0.5 font-semibold">
                              {discountValueText((data as any).discount_type, (data as any).discount_value) ?? "—"}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-black/50">Amount deducted</div>
                            <div className="mt-0.5 font-semibold">
                              -{formatMoney((data as any).discount_amount)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <></>
                    )}

                    <div className="rounded-2xl border border-black/10 bg-white p-4">
                      <div className="text-xs font-semibold text-black/60">Final price</div>
                      <div className="mt-1 text-sm font-bold">
                        {formatMoney(
                          discountLabel((data as any).discount_type)
                            ? (data as any).final_price ?? (data as any).total_price
                            : (data as any).total_price
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                        <div className="text-xs font-semibold text-black/60">Deposit made</div>
                        <div className="mt-1 text-sm font-semibold">{formatMoney((data as any).amount_paid)}</div>
                      </div>
                      <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                        <div className="text-xs font-semibold text-black/60">Balance remaining</div>
                        <div className="mt-1 text-sm font-semibold">{formatMoney((data as any).balance)}</div>
                      </div>
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

      {data && canEditOrder ? (
        <EditOrderModal
          open={editOpen}
          orderId={data.order_id}
          initial={data}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            setEditOpen(false);
            try {
              const refreshed = await ordersApi.get(id);
              setData(refreshed);
              toast.push("success", "Order updated");
            } catch (err) {
              toast.push("error", getErrorMessage(err));
            }
          }}
        />
      ) : null}

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

function EditOrderModal({
  open,
  orderId,
  initial,
  onClose,
  onSaved
}: {
  open: boolean;
  orderId: number;
  initial: Details;
  onClose(): void;
  onSaved(): Promise<void>;
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
  const [discountType, setDiscountType] = useState<"" | "fixed" | "percentage">(
    (initial as any).discount_type ?? ""
  );
  const [discountValue, setDiscountValue] = useState(
    (initial as any).discount_value != null ? String((initial as any).discount_value) : ""
  );
  const [items, setItems] = useState<
    Array<{ item_name: string; description: string; quantity: string }>
  >(
    initial.items.map((it) => ({
      item_name: it.item_name,
      description: it.description ?? "",
      quantity: String(it.quantity)
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
    setDiscountType(((initial as any).discount_type ?? "") as any);
    setDiscountValue((initial as any).discount_value != null ? String((initial as any).discount_value) : "");
    setItems(
      initial.items.map((it) => ({
        item_name: it.item_name,
        description: it.description ?? "",
        quantity: String(it.quantity)
      }))
    );
    setErr({});
  }, [open, initial]);

  function validate() {
    const e: Record<string, string> = {};
    const payload: OrderCreateItem[] = [];
    items.forEach((it, idx) => {
      const name = it.item_name.trim();
      const desc = it.description.trim();
      const qty = Number(it.quantity);
      if (!name) e[`n${idx}`] = "Item name required";
      if (!desc) e[`d${idx}`] = "Description required";
      if (!Number.isFinite(qty) || qty <= 0) e[`q${idx}`] = "Invalid quantity";
      if (name && desc && Number.isFinite(qty) && qty > 0) {
        payload.push({ item_name: name, description: desc, quantity: qty });
      }
    });
    if (payload.length === 0) e.items = "At least one valid item required";
    setErr(e);
    return { ok: Object.keys(e).length === 0, payload };
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const { ok, payload } = validate();
    if (!ok) return;
    setBusy(true);
    try {
      await ordersApi.updateAdmin(orderId, {
        status,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        items: payload,
        total_price: totalPrice.trim() === "" ? null : Number(totalPrice),
        amount_paid: deposit.trim() === "" ? null : Number(deposit),
        discount_type: discountType || null,
        discount_value: discountType ? (discountValue.trim() === "" ? 0 : Number(discountValue)) : null
      });
      await onSaved();
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
              <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_120px_auto] md:items-end">
                <Input
                  label={idx === 0 ? "Item name" : undefined}
                  value={it.item_name}
                  onChange={(e) =>
                    setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, item_name: e.target.value } : x)))
                  }
                  error={err[`n${idx}`]}
                />
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
                <Input
                  label={idx === 0 ? "Qty" : undefined}
                  value={it.quantity}
                  onChange={(e) =>
                    setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))
                  }
                  inputMode="numeric"
                  error={err[`q${idx}`]}
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={items.length <= 1}
                  onClick={() => setItems((xs) => xs.filter((_, i) => i !== idx))}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          {err.items ? <div className="mt-2 text-xs text-black/70">{err.items}</div> : null}
          <div className="mt-2">
            <Button type="button" variant="secondary" onClick={() => setItems((xs) => [...xs, { item_name: "", description: "", quantity: "1" }])}>
              Add item
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input
            label="Total price (optional)"
            value={totalPrice}
            onChange={(e) => setTotalPrice(e.target.value)}
            inputMode="decimal"
          />
          <Input
            label="Deposit made (optional)"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            inputMode="decimal"
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
          </label>
          <Input
            label="Discount value (optional)"
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            inputMode="decimal"
            placeholder={discountType === "percentage" ? "e.g. 10" : "e.g. 500.00"}
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

