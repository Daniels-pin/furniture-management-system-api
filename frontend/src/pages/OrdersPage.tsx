import { useEffect, useMemo, useState } from "react";
import type { Order, OrderCreateItem, OrderStatus } from "../types/api";
import { ordersApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { StatusBadge } from "../components/ui/StatusBadge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";
import { useNavigate } from "react-router-dom";
import { formatMoney } from "../utils/money";

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
  const nav = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 10;

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<OrderStatus | "all">("all");

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);

  const canCreate = auth.role === "showroom" || auth.role === "admin";
  function canDeleteOrder(o: Order): boolean {
    if (auth.role === "admin") return true;
    if (auth.role === "showroom" && typeof auth.userId === "number" && o.created_by_id === auth.userId) {
      return true;
    }
    return false;
  }
  const canSeePricing = auth.role === "admin" || auth.role === "showroom";
  const canInputPricingOnCreate = auth.role === "showroom" || auth.role === "admin";
  const canUpdateStatus = auth.role === "admin" || auth.role === "factory";

  const statusParam =
    status === "pending" || status === "in_progress" || status === "completed" ? status : undefined;

  async function refresh(nextPage?: number) {
    const targetPage = Math.max(1, nextPage ?? page);
    setIsLoading(true);
    try {
      const res = await ordersApi.list({
        search: q.trim() || undefined,
        status: statusParam,
        page: targetPage,
        limit
      });
      setOrders(Array.isArray(res.data) ? res.data : []);
      setPage(res.page || targetPage);
      setTotalPages(res.total_pages || 1);
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server-side search/filter with debounce
  useEffect(() => {
    const t = window.setTimeout(() => {
      void refresh(1);
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status]);

  async function openCreate() {
    setCreateOpen(true);
  }

  async function doDelete(orderId: number) {
    // IMPORTANT: NEVER send undefined or null order_id
    if (!Number.isFinite(orderId)) return;
    setDeletingId(orderId);
    const prev = orders;
    setOrders((xs) => xs.filter((x) => x.id !== orderId)); // immediate remove
    try {
      await ordersApi.delete(orderId);
      toast.push("success", `Order #${orderId} moved to Trash`);
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
          <Button variant="secondary" onClick={() => void refresh(page)} isLoading={isLoading}>
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
              ) : orders.length === 0 ? (
                <tr>
                  <td className="py-6 text-black/60" colSpan={canSeePricing ? 7 : 6}>
                    No orders found.
                  </td>
                </tr>
              ) : (
                orders.map((o, idx) => {
                  const displayNumber = String((page - 1) * limit + idx + 1).padStart(3, "0");
                  const d = daysRemaining(o.due_date ?? null);
                  return (
                    <tr
                      key={o.id}
                      className="cursor-pointer border-b border-black/5 transition hover:bg-black/[0.02]"
                      onClick={() => nav(`/orders/${o.id}`, { state: { displayNumber } })}
                    >
                      <td className="py-3 pr-4 font-semibold">#{displayNumber}</td>
                      <td className="py-3 pr-4">{o.customer?.name ?? "—"}</td>
                      <td className="py-3 pr-4">
                        {canUpdateStatus ? (
                          <select
                            className="w-full min-w-[160px] rounded-xl border border-black/15 bg-white px-2 py-1.5 text-sm shadow-sm"
                            value={o.status}
                            onChange={async (e) => {
                              e.stopPropagation();
                              const next = e.target.value as "pending" | "in_progress" | "completed";
                              try {
                                setOrders((xs) =>
                                  xs.map((x) => (x.id === o.id ? { ...x, status: next } : x))
                                );
                                await ordersApi.updateStatus(o.id, next);
                                await refresh(page);
                              } catch (err) {
                                toast.push("error", getErrorMessage(err));
                                await refresh(page);
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="pending">pending</option>
                            <option value="in_progress">in_progress</option>
                            <option value="completed">completed</option>
                          </select>
                        ) : (
                          <StatusBadge status={o.status} />
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        {o.due_date ? new Date(o.due_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3 pr-4">{d === null ? "—" : d}</td>
                      {canSeePricing ? (
                        <td className="py-3 pr-4 text-black/70">
                {o.total != null || o.final_price != null || o.total_price != null
                  ? `Total: ${formatMoney((o as any).total ?? o.final_price ?? o.total_price)}`
                            : "—"}
                        </td>
                      ) : null}
                      <td className="py-3 pr-0 text-right">
                        {canDeleteOrder(o) ? (
                          <Button
                            variant="ghost"
                            disabled={deletingId === o.id}
                            onClick={(e) => {
                              e.stopPropagation();
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

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs font-semibold text-black/50">
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={page <= 1 || isLoading}
              onClick={() => void refresh(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={page >= totalPages || isLoading}
              onClick={() => void refresh(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      <Modal
        open={confirmDeleteId !== null}
        title="Move order to Trash?"
        onClose={() => setConfirmDeleteId(null)}
      >
        <div className="space-y-4">
          <div className="text-sm text-black/70">
            The order will be moved to Trash. You can restore it from Trash unless an admin permanently purges it.
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
  canInputPricing,
  onCreated
}: {
  open: boolean;
  onClose(): void;
  canInputPricing: boolean;
  onCreated(): Promise<void>;
}) {
  const toast = useToast();

  const [customerName, setCustomerName] = useState<string>("");
  const [customerPhone, setCustomerPhone] = useState<string>("");
  const [customerAddress, setCustomerAddress] = useState<string>("");
  const [customerEmail, setCustomerEmail] = useState<string>("");

  const [items, setItems] = useState<
    Array<{ item_name: string; description: string; quantity: string; amount: string }>
  >([{ item_name: "", description: "", quantity: "1", amount: "" }]);
  const [dueDate, setDueDate] = useState<string>("");
  const [image, setImage] = useState<File | null>(null);
  const [amountPaid, setAmountPaid] = useState<string>("");
  const [discountType, setDiscountType] = useState<"" | "fixed" | "percentage">("");
  const [discountValue, setDiscountValue] = useState<string>("");
  const [tax, setTax] = useState<string>("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setCustomerName("");
    setCustomerPhone("");
    setCustomerAddress("");
    setCustomerEmail("");
    setItems([{ item_name: "", description: "", quantity: "1", amount: "" }]);
    setDueDate("");
    setImage(null);
    setAmountPaid("");
    setDiscountType("");
    setDiscountValue("");
    setTax("");
    setFieldError({});
    setIsSubmitting(false);
  }, [open]);

  const computedSubtotal = useMemo(() => {
    if (!items.length) return 0;
    let sum = 0;
    for (const it of items) {
      const qty = Number(it.quantity);
      const amt = Number(it.amount);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (!Number.isFinite(amt) || amt < 0) continue;
      sum += qty * amt;
    }
    return sum;
  }, [items]);

  function validate() {
    const e: Record<string, string> = {};

    if (!customerName.trim()) e.customerName = "Customer name is required";
    if (!customerPhone.trim()) e.customerPhone = "Phone is required";
    if (!customerAddress.trim()) e.customerAddress = "Address is required";
    const em = customerEmail.trim();
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      e.customerEmail = "Enter a valid email or leave blank";
    }

    const normalizedItems: OrderCreateItem[] = [];
    items.forEach((it, idx) => {
      const name = it.item_name.trim();
      const desc = it.description.trim();
      const qty = Number(it.quantity);
      const amt = it.amount.trim() === "" ? null : Number(it.amount);
      if (!name) e[`items.${idx}.item_name`] = "Item name is required";
      if (!desc) e[`items.${idx}.description`] = "Description is required";
      if (!Number.isFinite(qty) || qty <= 0) e[`items.${idx}.quantity`] = "Quantity must be > 0";
      if (it.amount.trim() === "") e[`items.${idx}.amount`] = "Amount is required";
      else if (!Number.isFinite(amt) || (amt as number) < 0) e[`items.${idx}.amount`] = "Amount must be >= 0";
      if (name && desc && Number.isFinite(qty) && qty > 0)
        normalizedItems.push({ item_name: name, description: desc, quantity: qty, amount: amt } as any);
    });

    if (normalizedItems.length === 0) e.items = "Items required";

    if (canInputPricing) {
      if (amountPaid && Number(amountPaid) < 0) e.amountPaid = "Deposit made cannot be negative";
      if (tax && Number(tax) < 0) e.tax = "Tax % cannot be negative";
      if (tax && Number(tax) > 100) e.tax = "Tax % cannot exceed 100";
      if (discountType) {
        const dv = Number(discountValue);
        if (!discountValue.trim() || !Number.isFinite(dv) || dv < 0) {
          e.discountValue = "Enter a valid discount value";
        }
        if (discountType === "percentage" && dv > 100) {
          e.discountValue = "Percentage discount must be <= 100";
        }
      } else if (discountValue.trim()) {
        e.discountType = "Select a discount type";
      }
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
      form.append("customer_name", customerName.trim());
      form.append("customer_phone", customerPhone.trim());
      form.append("customer_address", customerAddress.trim());
      if (customerEmail.trim()) form.append("customer_email", customerEmail.trim());

      const payload = items
        .map((it) => ({
          item_name: it.item_name.trim(),
          description: it.description.trim(),
          quantity: Number(it.quantity),
          amount: it.amount.trim() === "" ? null : Number(it.amount)
        }))
        .filter(
          (it) =>
            it.item_name &&
            it.description &&
            Number.isFinite(it.quantity) &&
            it.quantity > 0
        );
      form.append("items_json", JSON.stringify(payload));

      if (dueDate) form.append("due_date", new Date(dueDate).toISOString());
      if (image) form.append("image", image);

      if (canInputPricing) {
        // Subtotal is always system-calculated from items.
        form.append("total_price", String(computedSubtotal));
        if (amountPaid) form.append("amount_paid", amountPaid);
        if (discountType) form.append("discount_type", discountType);
        if (discountType && discountValue.trim()) form.append("discount_value", discountValue);
        if (tax.trim()) form.append("tax", tax.trim());
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
          <Input
            label="Customer name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            error={fieldError.customerName}
            required
          />
          <Input
            label="Phone"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            error={fieldError.customerPhone}
            required
          />
          <Input
            label="Address"
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
            error={fieldError.customerAddress}
            required
          />
          <Input
            label="Email (optional)"
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            error={fieldError.customerEmail}
            placeholder="customer@example.com"
          />
          <Input
            label="Due date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            type="date"
          />
        </div>

        <div>
          <div className="text-sm font-semibold">Items</div>
          <div className="mt-2 space-y-2">
            {items.map((it, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_140px_160px_90px] md:items-end"
              >
                <Input
                  label={idx === 0 ? "Item name" : undefined}
                  value={it.item_name}
                  onChange={(e) => {
                    const v = e.target.value;
                    setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, item_name: v } : x)));
                  }}
                  error={fieldError[`items.${idx}.item_name`]}
                  placeholder="e.g. Chair"
                />
                <label className="block md:col-span-1">
                  {idx === 0 ? <div className="mb-1 text-sm font-medium">Description</div> : null}
                  <textarea
                    className={[
                      "min-h-[88px] w-full rounded-xl border bg-white px-3 py-2 text-sm shadow-sm outline-none transition",
                      fieldError[`items.${idx}.description`] ? "border-black/30" : "border-black/15",
                      "focus:border-black/40"
                    ].join(" ")}
                    value={it.description}
                    onChange={(e) => {
                      const v = e.target.value;
                      setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, description: v } : x)));
                    }}
                    placeholder="e.g. Dining chair, walnut finish"
                  />
                  {fieldError[`items.${idx}.description`] ? (
                    <div className="mt-1 text-xs text-black/70">{fieldError[`items.${idx}.description`]}</div>
                  ) : null}
                </label>
                <Input
                  label={idx === 0 ? "Quantity" : undefined}
                  value={it.quantity}
                  onChange={(e) => {
                    const v = e.target.value;
                    setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, quantity: v } : x)));
                  }}
                  inputMode="numeric"
                  error={fieldError[`items.${idx}.quantity`]}
                  placeholder="1"
                />
                <Input
                  label={idx === 0 ? "Amount (unit)" : undefined}
                  value={it.amount}
                  onChange={(e) => {
                    const v = e.target.value;
                    setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, amount: v } : x)));
                  }}
                  inputMode="decimal"
                  error={fieldError[`items.${idx}.amount`]}
                  placeholder="e.g. 2500.00"
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
          {fieldError.items ? <div className="mt-2 text-xs text-black/70">{fieldError.items}</div> : null}
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setItems((xs) => [...xs, { item_name: "", description: "", quantity: "1", amount: "" }])}
            >
              Add item
            </Button>
          </div>
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
            <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 md:col-span-2">
              <div className="text-xs font-semibold text-black/60">Subtotal (auto-calculated)</div>
              <div className="mt-1 text-lg font-bold tracking-tight">{formatMoney(computedSubtotal)}</div>
              <div className="mt-1 text-xs text-black/50">Calculated as Quantity × Amount per item.</div>
            </div>
            <Input
              label="Deposit made (optional)"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              inputMode="decimal"
              error={fieldError.amountPaid}
              placeholder="e.g. 500.00"
            />
            <Select
              label="Discount type (optional)"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as any)}
              options={[
                { value: "", label: "No discount" },
                { value: "fixed", label: "Fixed" },
                { value: "percentage", label: "Percentage" }
              ]}
            />
            <Input
              label="Discount value (optional)"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              inputMode="decimal"
              error={fieldError.discountType || fieldError.discountValue}
              placeholder={discountType === "percentage" ? "e.g. 10" : "e.g. 500.00"}
            />
            <Input
              label="Tax % (optional)"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              inputMode="decimal"
              error={fieldError.tax}
              placeholder="e.g. 7.5 for 7.5% VAT"
            />
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            Create order
          </Button>
        </div>
      </form>
    </Modal>
  );
}

