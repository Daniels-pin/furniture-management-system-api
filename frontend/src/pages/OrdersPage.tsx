import { useEffect, useMemo, useState } from "react";
import type { Customer, Order, OrderStatus, Product } from "../types/api";
import { customersApi, ordersApi, productsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";

function daysRemaining(dueDateIso?: string | null) {
  if (!dueDateIso) return null;
  const due = new Date(dueDateIso);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const ms = due.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function statusLabel(s: OrderStatus) {
  if (s === "in_progress") return "In progress";
  return s[0].toUpperCase() + s.slice(1);
}

export function OrdersPage() {
  const auth = useAuth();
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<OrderStatus | "all">("all");

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const canCreate = auth.role === "showroom" || auth.role === "admin";
  const canDelete = auth.role === "admin";
  const canSeePricing = auth.role === "admin";
  const canInputPricingOnCreate = auth.role === "showroom" || auth.role === "admin";

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return orders.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (!query) return true;
      const customerName = o.customer?.name?.toLowerCase?.() ?? "";
      return (
        String(o.id).includes(query) ||
        customerName.includes(query) ||
        o.status.toLowerCase().includes(query)
      );
    });
  }, [orders, q, status]);

  async function refresh() {
    setIsLoading(true);
    try {
      const data = await ordersApi.list();
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openCreate() {
    setCreateOpen(true);
    try {
      const [c, p] = await Promise.all([customersApi.list(), productsApi.list()]);
      setCustomers(Array.isArray(c) ? c : []);
      setProducts(Array.isArray(p) ? p : []);
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    }
  }

  async function doDelete(orderId: number) {
    // IMPORTANT: NEVER send undefined or null order_id
    if (!Number.isFinite(orderId)) return;
    setDeletingId(orderId);
    const prev = orders;
    setOrders((xs) => xs.filter((x) => x.id !== orderId)); // immediate remove
    try {
      await ordersApi.delete(orderId);
      toast.push("success", `Order #${orderId} deleted`);
    } catch (err) {
      setOrders(prev); // revert
      toast.push("error", getErrorMessage(err));
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Orders</div>
          <div className="mt-1 text-sm text-black/60">Track status and due dates.</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void refresh()} isLoading={isLoading}>
            Refresh
          </Button>
          {canCreate ? <Button onClick={() => void openCreate()}>Create order</Button> : null}
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input
            label="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Order ID, customer, status…"
          />
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            options={[
              { value: "all", label: "All" },
              { value: "pending", label: "Pending" },
              { value: "in_progress", label: "In progress" },
              { value: "completed", label: "Completed" },
              { value: "delivered", label: "Delivered" }
            ]}
          />
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-black/60">
              <tr className="border-b border-black/10">
                <th className="py-3 pr-4 font-semibold">Order ID</th>
                <th className="py-3 pr-4 font-semibold">Customer</th>
                <th className="py-3 pr-4 font-semibold">Status</th>
                <th className="py-3 pr-4 font-semibold">Due Date</th>
                <th className="py-3 pr-4 font-semibold">Days Remaining</th>
                {canSeePricing ? <th className="py-3 pr-4 font-semibold">Pricing</th> : null}
                <th className="py-3 pr-0 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="py-6 text-black/60" colSpan={canSeePricing ? 7 : 6}>
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td className="py-6 text-black/60" colSpan={canSeePricing ? 7 : 6}>
                    No orders found.
                  </td>
                </tr>
              ) : (
                filtered.map((o) => {
                  const d = daysRemaining(o.due_date ?? null);
                  return (
                    <tr key={o.id} className="border-b border-black/5">
                      <td className="py-3 pr-4 font-semibold">#{o.id}</td>
                      <td className="py-3 pr-4">{o.customer?.name ?? "—"}</td>
                      <td className="py-3 pr-4">
                        <Badge>{statusLabel(o.status)}</Badge>
                      </td>
                      <td className="py-3 pr-4">
                        {o.due_date ? new Date(o.due_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3 pr-4">{d === null ? "—" : d}</td>
                      {canSeePricing ? (
                        <td className="py-3 pr-4 text-black/70">
                          {o.total_price != null ? `Total: ${o.total_price}` : "—"}
                        </td>
                      ) : null}
                      <td className="py-3 pr-0 text-right">
                        {canDelete ? (
                          <Button
                            variant="ghost"
                            disabled={deletingId === o.id}
                            onClick={() => {
                              if (typeof o.id === "number") setConfirmDeleteId(o.id);
                            }}
                          >
                            Delete
                          </Button>
                        ) : (
                          <span className="text-black/30">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={confirmDeleteId !== null}
        title="Delete order?"
        onClose={() => setConfirmDeleteId(null)}
      >
        <div className="space-y-4">
          <div className="text-sm text-black/70">
            This action cannot be undone. The order and its items will be removed.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={confirmDeleteId !== null && deletingId === confirmDeleteId}
              onClick={() => {
                if (confirmDeleteId === null) return;
                void doDelete(confirmDeleteId);
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      <CreateOrderModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        customers={customers}
        products={products}
        canInputPricing={canInputPricingOnCreate}
        onCreated={async () => {
          setCreateOpen(false);
          await refresh();
        }}
      />
    </div>
  );
}

function CreateOrderModal({
  open,
  onClose,
  customers,
  products,
  canInputPricing,
  onCreated
}: {
  open: boolean;
  onClose(): void;
  customers: Customer[];
  products: Product[];
  canInputPricing: boolean;
  onCreated(): Promise<void>;
}) {
  const toast = useToast();

  const [customerId, setCustomerId] = useState<string>("");
  const [productId, setProductId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("1");
  const [dueDate, setDueDate] = useState<string>("");
  const [image, setImage] = useState<File | null>(null);
  const [totalPrice, setTotalPrice] = useState<string>("");
  const [amountPaid, setAmountPaid] = useState<string>("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setCustomerId(customers[0]?.id ? String(customers[0].id) : "");
    setProductId(products[0]?.id ? String(products[0].id) : "");
    setQuantity("1");
    setDueDate("");
    setImage(null);
    setTotalPrice("");
    setAmountPaid("");
    setFieldError({});
    setIsSubmitting(false);
  }, [open, customers, products]);

  function validate() {
    const e: Record<string, string> = {};
    if (!customerId) e.customerId = "Customer is required";
    if (!productId) e.productId = "Product is required";
    const qNum = Number(quantity);
    if (!Number.isFinite(qNum) || qNum <= 0) e.quantity = "Quantity must be a positive number";
    if (canInputPricing) {
      if (totalPrice && Number(totalPrice) < 0) e.totalPrice = "Total price cannot be negative";
      if (amountPaid && Number(amountPaid) < 0) e.amountPaid = "Amount paid cannot be negative";
    }
    setFieldError(e);
    return Object.keys(e).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const form = new FormData();
      form.append("customer_id", customerId);
      form.append("product_id", productId);
      form.append("quantity", quantity);
      if (dueDate) form.append("due_date", new Date(dueDate).toISOString());
      if (image) form.append("image", image);

      if (canInputPricing) {
        if (totalPrice) form.append("total_price", totalPrice);
        if (amountPaid) form.append("amount_paid", amountPaid);
      }

      await ordersApi.createMultipart(form);
      toast.push("success", "Order created");
      await onCreated();
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal open={open} title="Create order" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Select
            label="Customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            error={fieldError.customerId}
            options={[
              { value: "", label: customers.length ? "Select customer…" : "No customers available" },
              ...customers.map((c) => ({ value: String(c.id), label: c.name }))
            ]}
          />
          <Select
            label="Product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            error={fieldError.productId}
            options={[
              { value: "", label: products.length ? "Select product…" : "No products available" },
              ...products.map((p) => ({ value: String(p.id), label: `${p.name} — ${p.price}` }))
            ]}
          />
          <Input
            label="Quantity"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            inputMode="numeric"
            error={fieldError.quantity}
          />
          <Input
            label="Due date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            type="date"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block">
            <div className="mb-1 text-sm font-medium">Image</div>
            <input
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm"
              type="file"
              accept="image/*"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            />
            <div className="mt-1 text-xs text-black/50">Optional. Uploads via backend to Cloudinary.</div>
          </label>
        </div>

        {canInputPricing ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              label="Total price (optional)"
              value={totalPrice}
              onChange={(e) => setTotalPrice(e.target.value)}
              inputMode="decimal"
              error={fieldError.totalPrice}
              placeholder="e.g. 2500.00"
            />
            <Input
              label="Amount paid (optional)"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              inputMode="decimal"
              error={fieldError.amountPaid}
              placeholder="e.g. 500.00"
            />
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

