import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Order, OrderCreateItem, OrderStatus } from "../types/api";
import { draftsApi, ordersApi } from "../services/endpoints";
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
import { isValidThousandsCommaNumber, parseMoneyInput, sanitizeMoneyInput } from "../utils/moneyInput";
import { usePageHeader } from "../components/layout/pageHeader";
import { consumeDraftRecoveryIntent } from "../state/drafts";

function daysRemaining(dueDateIso?: string | null) {
  if (!dueDateIso) return null;
  const due = new Date(dueDateIso);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const ms = due.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function statusLabel(s: OrderStatus) {
  if (s === "in_progress") return "In Progress";
  if (s === "completed" || s === "delivered") return "Completed";
  return s[0].toUpperCase() + s.slice(1);
}

function statusUi(s: OrderStatus): { label: string; pillClass: string; dotClass: string } {
  const label = statusLabel(s);
  if (s === "pending") {
    return {
      label,
      pillClass: "bg-black/5 text-black/70 ring-black/10",
      dotClass: "bg-black/30"
    };
  }
  if (s === "in_progress") {
    return {
      label,
      pillClass: "bg-yellow-100 text-yellow-900 ring-yellow-200",
      dotClass: "bg-yellow-400"
    };
  }
  // completed + delivered
  return {
    label,
    pillClass: "bg-green-100 text-green-900 ring-green-200",
    dotClass: "bg-green-500"
  };
}

function StatusDropdown({
  value,
  onChange
}: {
  value: "pending" | "in_progress" | "completed";
  onChange(next: "pending" | "in_progress" | "completed"): void;
}) {
  const ui = statusUi(value);
  const basePill = "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-inset";
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  function updatePos() {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 8, // 8px gap
      left: r.left,
      width: Math.max(220, r.width)
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const btn = btnRef.current;
      const menu = menuRef.current;
      const t = e.target as Node | null;
      if (!btn || !t) return;
      if (btn.contains(t)) return; // handled by button click
      if (menu && menu.contains(t)) return; // selecting menu item
      setOpen(false);
    };
    // capture helps when row/table has handlers
    window.addEventListener("keydown", onKeyDown, { capture: true } as any);
    window.addEventListener("pointerdown", onPointerDown, { capture: true } as any);
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true } as any);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true } as any);
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={[
          basePill,
          ui.pillClass,
          "cursor-pointer select-none shadow-sm hover:opacity-95"
        ].join(" ")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => {
            const next = !v;
            if (!v && next) updatePos();
            return next;
          });
        }}
      >
        <span className={["h-2.5 w-2.5 rounded-full", ui.dotClass].join(" ")} />
        {ui.label}
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="fixed z-[1000]"
              style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
              role="menu"
              aria-label="Update order status"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="overflow-hidden rounded-2xl border border-black/10 bg-white p-1 shadow-xl">
                {(["pending", "in_progress", "completed"] as const).map((s) => {
                  const opt = statusUi(s);
                  const active = s === value;
                  return (
                    <button
                      key={s}
                      type="button"
                      className={[
                        "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm font-semibold",
                        active ? "bg-black text-white" : "text-black hover:bg-black/5"
                      ].join(" ")}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onChange(s);
                        setOpen(false);
                      }}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span className={["h-2.5 w-2.5 rounded-full", opt.dotClass].join(" ")} />
                        {opt.label}
                      </span>
                      {active ? <span className="text-xs font-bold">Selected</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export function OrdersPage() {
  const auth = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  usePageHeader({
    title: "Orders",
    subtitle: "Track status and due dates."
  });

  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 10;

  const [q, setQ] = useState("");
  const [view, setView] = useState<"open" | "completed">("open");

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [draftPromptOpen, setDraftPromptOpen] = useState(false);
  const [draftPromptLoading, setDraftPromptLoading] = useState(false);
  const [initialDraft, setInitialDraft] = useState<any | null>(null);

  const localKey = "draft_v1:order";

  async function loadDraft(): Promise<any | null> {
    try {
      const res = await draftsApi.get<any>("order");
      return res?.data ?? null;
    } catch {
      try {
        const raw = localStorage.getItem(localKey);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }
  }

  async function discardDraft() {
    setDraftPromptLoading(true);
    try {
      await draftsApi.remove("order");
    } catch {
      // ignore
    }
    try {
      localStorage.removeItem(localKey);
    } catch {
      // ignore
    }
    setInitialDraft(null);
    setDraftPromptLoading(false);
    toast.push("success", "Draft discarded");
  }

  const canCreate = auth.role === "showroom" || auth.role === "admin";
  function canDeleteOrder(o: Order): boolean {
    if (auth.role === "admin") return true;
    if (auth.role === "showroom" && typeof auth.userId === "number" && o.created_by_id === auth.userId) {
      return true;
    }
    return false;
  }
  const canSeePricing = auth.role === "admin" || auth.role === "showroom" || auth.role === "finance";
  const canInputPricingOnCreate = auth.role === "showroom" || auth.role === "admin";
  const canUpdateStatus = auth.role === "admin" || auth.role === "factory";

  const statusParam = view === "completed" ? "completed" : "open";

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
  }, [q, view]);

  async function openCreate() {
    setCreateOpen(true);
  }

  // Prompt on module entry if a draft exists.
  useEffect(() => {
    const intent = consumeDraftRecoveryIntent();
    let alive = true;
    (async () => {
      const d = await loadDraft();
      if (!alive) return;
      if (!d) return;
      if (intent === "order") {
        setInitialDraft(d);
        setCreateOpen(true);
        return;
      }
      setInitialDraft(d);
      setDraftPromptOpen(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <Modal
        open={draftPromptOpen}
        title="Unfinished Order"
        onClose={() => {
          // force explicit choice
        }}
      >
        <div className="space-y-4">
          <div className="text-sm text-black/70">
            You have an unfinished <span className="font-semibold">Order</span>. Do you want to continue where you left off?
          </div>
          <div className="text-xs font-semibold text-black/40">
            Note: selected images can’t be restored and may need to be re-added.
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              isLoading={draftPromptLoading}
              onClick={async () => {
                await discardDraft();
                setDraftPromptOpen(false);
              }}
            >
              Discard
            </Button>
            <Button
              isLoading={draftPromptLoading}
              onClick={async () => {
                setDraftPromptLoading(true);
                const d = await loadDraft();
                setInitialDraft(d);
                setDraftPromptLoading(false);
                setDraftPromptOpen(false);
                setCreateOpen(true);
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      </Modal>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={view === "open" ? "primary" : "secondary"}
            onClick={() => {
              setView("open");
              setPage(1);
            }}
          >
            Orders
          </Button>
          <Button
            variant={view === "completed" ? "primary" : "secondary"}
            onClick={() => {
              setView("completed");
              setPage(1);
            }}
          >
            Completed
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          <div className="flex items-end justify-between rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-3">
            <div>
              <div className="text-xs font-semibold text-black/55">Showing</div>
              <div className="mt-1 text-sm font-bold">
                {view === "completed" ? "Completed orders" : "Pending + In Progress"}
              </div>
              {view === "completed" ? (
                <div className="mt-1 text-xs text-black/50">Only completed orders are listed.</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-5 min-w-0 overflow-x-touch">
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
                (() => {
                  const pending = orders.filter((o) => o.status === "pending");
                  const progress = orders.filter((o) => o.status === "in_progress");
                  const completed = orders.filter((o) => o.status === "completed" || o.status === "delivered");

                  const sections: Array<{ key: string; title: string; rows: Order[] }> =
                    view === "completed"
                      ? [{ key: "completed", title: "Completed", rows: completed }]
                      : [
                          { key: "pending", title: "Pending", rows: pending },
                          { key: "in_progress", title: "In Progress", rows: progress }
                        ];

                  let runningIndex = 0;

                  return sections.flatMap((sec) => {
                    if (!sec.rows.length) return [];
                    const header = (
                      <tr key={`hdr:${sec.key}`} className="bg-black/[0.02]">
                        <td className="py-2 pr-4 text-xs font-bold uppercase tracking-[0.08em] text-black/60" colSpan={canSeePricing ? 7 : 6}>
                          {sec.title}
                        </td>
                      </tr>
                    );
                    const rows = sec.rows.map((o) => {
                      runningIndex += 1;
                      const displayNumber = String((page - 1) * limit + runningIndex).padStart(3, "0");
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
                              <StatusDropdown
                                value={(o.status === "pending" || o.status === "in_progress" || o.status === "completed"
                                  ? o.status
                                  : "completed") as any}
                                onChange={async (next) => {
                                  try {
                                    setOrders((xs) => xs.map((x) => (x.id === o.id ? { ...x, status: next } : x)));
                                    await ordersApi.updateStatus(o.id, next);
                                    await refresh(page);
                                  } catch (err) {
                                    toast.push("error", getErrorMessage(err));
                                    await refresh(page);
                                  }
                                }}
                              />
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
                    });

                    return [header, ...rows];
                  });
                })()
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
        initialDraft={initialDraft}
        onDraftCleared={() => setInitialDraft(null)}
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
  initialDraft,
  onDraftCleared,
  onCreated
}: {
  open: boolean;
  onClose(): void;
  canInputPricing: boolean;
  initialDraft?: any | null;
  onDraftCleared?(): void;
  onCreated(): Promise<void>;
}) {
  const toast = useToast();
  const localKey = "draft_v1:order";

  const [customerName, setCustomerName] = useState<string>("");
  const [customerPhone, setCustomerPhone] = useState<string>("");
  const [customerAddress, setCustomerAddress] = useState<string>("");
  const [customerEmail, setCustomerEmail] = useState<string>("");
  const [customerBirthDay, setCustomerBirthDay] = useState<string>("");
  const [customerBirthMonth, setCustomerBirthMonth] = useState<string>("");

  const [items, setItems] = useState<
    Array<{ item_name: string; description: string; quantity: string; amount: string }>
  >([{ item_name: "", description: "", quantity: "1", amount: "" }]);
  const [dueDate, setDueDate] = useState<string>("");
  const [images, setImages] = useState<File[]>([]);
  const [amountPaid, setAmountPaid] = useState<string>("");
  const [discountType, setDiscountType] = useState<"" | "fixed" | "percentage">("");
  const [discountValue, setDiscountValue] = useState<string>("");
  const [tax, setTax] = useState<string>("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const d = initialDraft || null;
    setCustomerName(String(d?.customerName ?? ""));
    setCustomerPhone(String(d?.customerPhone ?? ""));
    setCustomerAddress(String(d?.customerAddress ?? ""));
    setCustomerEmail(String(d?.customerEmail ?? ""));
    setCustomerBirthDay(String(d?.customerBirthDay ?? ""));
    setCustomerBirthMonth(String(d?.customerBirthMonth ?? ""));
    setItems(
      Array.isArray(d?.items) && d.items.length
        ? d.items.map((it: any) => ({
            item_name: String(it?.item_name ?? ""),
            description: String(it?.description ?? ""),
            quantity: String(it?.quantity ?? "1"),
            amount: String(it?.amount ?? "")
          }))
        : [{ item_name: "", description: "", quantity: "1", amount: "" }]
    );
    setDueDate(String(d?.dueDate ?? ""));
    setImages([]); // cannot restore files
    setAmountPaid(String(d?.amountPaid ?? ""));
    setDiscountType(d?.discountType === "fixed" || d?.discountType === "percentage" ? d.discountType : "");
    setDiscountValue(String(d?.discountValue ?? ""));
    setTax(String(d?.tax ?? ""));
    setFieldError({});
    setIsSubmitting(false);
  }, [open, initialDraft]);

  // Autosave while modal is open.
  useEffect(() => {
    if (!open) return;
    const payload = {
      customerName,
      customerPhone,
      customerAddress,
      customerEmail,
      customerBirthDay,
      customerBirthMonth,
      items,
      dueDate,
      amountPaid,
      discountType,
      discountValue,
      tax
    };
    try {
      localStorage.setItem(localKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
    const t = window.setTimeout(() => {
      void draftsApi.upsert("order", payload as any).catch(() => {});
    }, 1200);
    return () => window.clearTimeout(t);
  }, [
    open,
    customerName,
    customerPhone,
    customerAddress,
    customerEmail,
    customerBirthDay,
    customerBirthMonth,
    items,
    dueDate,
    amountPaid,
    discountType,
    discountValue,
    tax
  ]);

  const computedSubtotal = useMemo(() => {
    if (!items.length) return 0;
    let sum = 0;
    for (const it of items) {
      const qty = Number(it.quantity);
      const amt = parseMoneyInput(it.amount);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (amt === null || !Number.isFinite(amt) || amt < 0) continue;
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

    const bdRaw = customerBirthDay.trim();
    const bmRaw = customerBirthMonth.trim();
    if (bdRaw || bmRaw) {
      const bd = Number(bdRaw);
      const bm = Number(bmRaw);
      if (!bdRaw || !bmRaw) {
        e.customerBirthDay = e.customerBirthDay || "Enter both day and month, or leave both blank";
        e.customerBirthMonth = e.customerBirthMonth || "Enter both day and month, or leave both blank";
      } else if (!Number.isFinite(bd) || bd < 1 || bd > 31) {
        e.customerBirthDay = "Day must be 1–31";
      } else if (!Number.isFinite(bm) || bm < 1 || bm > 12) {
        e.customerBirthMonth = "Month must be 1–12";
      }
    }

    const normalizedItems: OrderCreateItem[] = [];
    items.forEach((it, idx) => {
      const name = it.item_name.trim();
      const desc = it.description.trim();
      const qty = Number(it.quantity);
      const amt = parseMoneyInput(it.amount);
      if (!name) e[`items.${idx}.item_name`] = "Item name is required";
      if (!desc) e[`items.${idx}.description`] = "Description is required";
      if (!Number.isFinite(qty) || qty <= 0) e[`items.${idx}.quantity`] = "Quantity must be > 0";
      if (it.amount.trim() === "") e[`items.${idx}.amount`] = "Amount is required";
      else if (amt === null || !Number.isFinite(amt) || amt < 0) {
        e[`items.${idx}.amount`] = isValidThousandsCommaNumber(it.amount) ? "Amount must be >= 0" : "Invalid comma formatting";
      }
      if (name && desc && Number.isFinite(qty) && qty > 0)
        normalizedItems.push({ item_name: name, description: desc, quantity: qty, amount: amt } as any);
    });

    if (normalizedItems.length === 0) e.items = "Items required";

    if (canInputPricing) {
      if (amountPaid.trim() && !isValidThousandsCommaNumber(amountPaid)) e.amountPaid = "Invalid comma formatting";
      const ap = parseMoneyInput(amountPaid);
      if (amountPaid.trim() && (ap === null || !Number.isFinite(ap) || ap < 0)) e.amountPaid = e.amountPaid || "Deposit made cannot be negative";

      if (tax.trim() && !isValidThousandsCommaNumber(tax)) e.tax = "Invalid comma formatting";
      const tx = parseMoneyInput(tax);
      if (tax.trim() && (tx === null || !Number.isFinite(tx) || tx < 0)) e.tax = e.tax || "Tax % cannot be negative";
      if (tax.trim() && tx !== null && Number.isFinite(tx) && tx > 100) e.tax = "Tax % cannot exceed 100";
      if (discountType) {
        if (discountValue.trim() && !isValidThousandsCommaNumber(discountValue)) {
          e.discountValue = "Invalid comma formatting";
        }
        const dv = parseMoneyInput(discountValue);
        if (!discountValue.trim() || dv === null || !Number.isFinite(dv) || dv < 0) {
          e.discountValue = "Enter a valid discount value";
        }
        if (discountType === "percentage" && dv !== null && Number.isFinite(dv) && dv > 100) {
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
      if (customerBirthDay.trim() && customerBirthMonth.trim()) {
        form.append("customer_birth_day", customerBirthDay.trim());
        form.append("customer_birth_month", customerBirthMonth.trim());
      }

      const payload = items
        .map((it) => ({
          item_name: it.item_name.trim(),
          description: it.description.trim(),
          quantity: Number(it.quantity),
          amount: it.amount.trim() === "" ? null : Number(sanitizeMoneyInput(it.amount))
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
      for (const f of images) form.append("images", f);

      if (canInputPricing) {
        // Subtotal is always system-calculated from items.
        form.append("total_price", String(computedSubtotal));
        if (amountPaid.trim()) form.append("amount_paid", sanitizeMoneyInput(amountPaid));
        if (discountType) form.append("discount_type", discountType);
        if (discountType && discountValue.trim()) form.append("discount_value", sanitizeMoneyInput(discountValue));
        if (tax.trim()) form.append("tax", sanitizeMoneyInput(tax.trim()));
      }

      await ordersApi.createMultipart(form);
      toast.push("success", "Order created");
      // Clear autosaved draft on successful submission.
      try {
        await draftsApi.remove("order");
      } catch {
        // ignore
      }
      try {
        localStorage.removeItem(localKey);
      } catch {
        // ignore
      }
      onDraftCleared?.();
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
            label="Birth day (optional)"
            value={customerBirthDay}
            onChange={(e) => setCustomerBirthDay(e.target.value)}
            error={fieldError.customerBirthDay}
            inputMode="numeric"
            placeholder="1–31"
          />
          <Input
            label="Birth month (optional)"
            value={customerBirthMonth}
            onChange={(e) => setCustomerBirthMonth(e.target.value)}
            error={fieldError.customerBirthMonth}
            inputMode="numeric"
            placeholder="1–12"
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
              multiple
              onChange={(e) => setImages(Array.from(e.target.files ?? []))}
            />
            <div className="mt-1 text-xs text-black/50">Optional. You can select multiple images; uploads via backend to Cloudinary.</div>
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

