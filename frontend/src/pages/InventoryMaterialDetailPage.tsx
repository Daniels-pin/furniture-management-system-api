import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { InventoryMaterialDetail, InventoryMovement, InventoryPayment } from "../types/api";
import { inventoryApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { formatMoney } from "../utils/money";
import { isValidThousandsCommaNumber, sanitizeMoneyInput } from "../utils/moneyInput";

function fmtNum(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function fmtWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function toLocalDatetimeValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function movementDetailText(m: InventoryMovement): string {
  const meta = m.meta;
  if (!meta || typeof meta !== "object") return "—";
  const o = meta as Record<string, unknown>;
  if (typeof o.stock_level_before === "string") {
    return `${o.stock_level_before}→${String(o.stock_level_after ?? "")}`;
  }
  if (o.kind === "purchase") {
    const parts: string[] = [];
    if (o.purchase_amount != null && String(o.purchase_amount).trim()) {
      parts.push(`Liability +${String(o.purchase_amount)}`);
    }
    if (typeof o.note === "string" && o.note.trim()) parts.push(o.note);
    return parts.length ? parts.join(" · ") : "Purchase";
  }
  if (typeof o.note === "string" && o.note.trim()) return o.note;
  return "—";
}

export function InventoryMaterialDetailPage() {
  const { materialId } = useParams();
  const id = Number(materialId);
  const toast = useToast();
  const auth = useAuth();

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<InventoryMaterialDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [moveLoading, setMoveLoading] = useState(false);

  const [purQty, setPurQty] = useState("");
  const [purAmount, setPurAmount] = useState("");
  const [purNote, setPurNote] = useState("");
  const [purSaving, setPurSaving] = useState(false);

  const [useQty, setUseQty] = useState("");
  const [useNote, setUseNote] = useState("");
  const [useSaving, setUseSaving] = useState(false);

  const [payList, setPayList] = useState<InventoryPayment[]>([]);
  const [payLoading, setPayLoading] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paySaving, setPaySaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null);

  const loadDetail = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    setLoading(true);
    setNotFound(false);
    try {
      const d = await inventoryApi.getDetail(id);
      setDetail(d);
    } catch (e: unknown) {
      if ((e as { response?: { status?: number } })?.response?.status === 404) setNotFound(true);
      else toast.push("error", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  const loadMovements = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    setMoveLoading(true);
    try {
      const data = await inventoryApi.movements({ material_id: id, limit: 150 });
      setMovements(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setMoveLoading(false);
    }
  }, [id, toast]);

  const loadPayments = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    setPayLoading(true);
    try {
      const list = await inventoryApi.listPayments(id);
      setPayList(Array.isArray(list) ? list : []);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setPayLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!detail) return;
    void loadMovements();
    void loadPayments();
  }, [detail, loadMovements, loadPayments]);

  const mat = detail?.material;

  async function submitPurchase() {
    if (!mat || mat.tracking_mode !== "numeric") return;
    const raw = purQty.trim();
    if (!raw) {
      toast.push("error", "Enter quantity received");
      return;
    }
    const q = Number(raw);
    if (!Number.isFinite(q) || q <= 0) {
      toast.push("error", "Quantity must be a positive number");
      return;
    }
    let purchase_amount: string | undefined;
    if (purAmount.trim()) {
      if (!isValidThousandsCommaNumber(purAmount)) {
        toast.push("error", "Fix purchase amount formatting");
        return;
      }
      purchase_amount = sanitizeMoneyInput(purAmount.trim());
    }
    setPurSaving(true);
    try {
      const out = await inventoryApi.postPurchase(mat.id, {
        quantity: q,
        ...(purchase_amount ? { purchase_amount } : {}),
        note: purNote.trim() || null
      });
      setDetail(out);
      setPurQty("");
      setPurAmount("");
      setPurNote("");
      toast.push("success", "Purchase recorded");
      await loadMovements();
      await loadPayments();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setPurSaving(false);
    }
  }

  async function submitUsage() {
    if (!mat || mat.tracking_mode !== "numeric") return;
    const raw = useQty.trim();
    if (!raw) {
      toast.push("error", "Enter quantity used");
      return;
    }
    const q = Number(raw);
    if (!Number.isFinite(q) || q <= 0) {
      toast.push("error", "Quantity must be a positive number");
      return;
    }
    setUseSaving(true);
    try {
      await inventoryApi.postMovement(mat.id, {
        action: "used",
        quantity_delta: -Math.abs(q),
        note: useNote.trim() || undefined
      });
      toast.push("success", "Usage recorded");
      setUseQty("");
      setUseNote("");
      await loadDetail();
      await loadMovements();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setUseSaving(false);
    }
  }

  async function submitPayment() {
    if (!mat) return;
    const raw = payAmount.trim();
    if (!raw) {
      toast.push("error", "Enter payment amount");
      return;
    }
    if (!isValidThousandsCommaNumber(raw)) {
      toast.push("error", "Fix comma formatting");
      return;
    }
    if (!payDate.trim()) {
      toast.push("error", "Choose payment date");
      return;
    }
    setPaySaving(true);
    try {
      await inventoryApi.addPayment(mat.id, {
        amount: sanitizeMoneyInput(raw),
        paid_at: new Date(payDate).toISOString(),
        note: payNote.trim() || null
      });
      toast.push("success", "Payment recorded");
      setPayAmount("");
      setPayNote("");
      await loadDetail();
      await loadPayments();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setPaySaving(false);
    }
  }

  async function removePayment(paymentId: number) {
    if (!mat) return;
    setConfirmAction(() => async () => {
      if (!mat) return;
      await inventoryApi.deletePayment(mat.id, paymentId);
      toast.push("success", "Payment removed");
      await loadDetail();
      await loadPayments();
    });
    setConfirmOpen(true);
  }

  useEffect(() => {
    if (!mat) return;
    setPayDate(toLocalDatetimeValue(new Date()));
  }, [mat?.id]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">
            {loading ? "Loading…" : mat ? mat.material_name : notFound ? "Not found" : "—"}
          </div>
          <div className="mt-1 text-sm text-black/60">
            {mat ? (
              <>
                {mat.tracking_mode === "numeric" ? "Numeric tracking" : "Status-only tracking"} · {mat.unit}
                {mat.category ? ` · ${mat.category}` : null}
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/inventory"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-black/5 active:translate-y-[1px]"
          >
            Back to inventory
          </Link>
        </div>
      </div>

      {loading ? (
        <Card className="p-6 text-sm text-black/60">Loading…</Card>
      ) : notFound || !detail || !mat ? (
        <Card className="p-6 text-sm font-semibold">Material not found.</Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="p-4">
              <div className="text-xs font-semibold text-black/55">Total purchased (inbound)</div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {fmtNum(detail.stats.total_quantity_purchased)} {mat.tracking_mode === "numeric" ? mat.unit : ""}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold text-black/55">Total used</div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {fmtNum(detail.stats.total_quantity_used)} {mat.tracking_mode === "numeric" ? mat.unit : ""}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold text-black/55">Current stock</div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {mat.tracking_mode === "numeric" ? `${fmtNum(mat.quantity)} ${mat.unit}` : "—"}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold text-black/55">Supplier liability (total cost)</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{formatMoney(mat.cost)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold text-black/55">Total paid</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{formatMoney(mat.amount_paid)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold text-black/55">Outstanding</div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {mat.balance === null || mat.balance === undefined ? "—" : formatMoney(mat.balance)}
              </div>
            </Card>
          </div>

          <Card className="p-4">
            <div className="text-sm font-semibold">Supplier & notes</div>
            <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
              <div>
                <span className="text-black/55">Supplier:</span>{" "}
                <span className="font-medium">{mat.supplier_name || "—"}</span>
              </div>
              <div>
                <span className="text-black/55">Payment status:</span>{" "}
                <span className="font-medium capitalize">{mat.payment_status}</span>
              </div>
            </div>
            {mat.notes ? (
              <div className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] p-3 text-sm text-black/80">{mat.notes}</div>
            ) : null}
            <p className="mt-3 text-xs text-black/50">
              New purchases logged below add to <span className="font-semibold">Total purchased</span> and optionally increase{" "}
              <span className="font-semibold">Supplier liability</span>. Payments reduce outstanding without removing movement history.
            </p>
          </Card>

          {mat.tracking_mode === "numeric" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <div className="text-sm font-semibold">Log new purchase (add stock)</div>
                <div className="mt-3 space-y-3">
                  <Input label="Quantity received" inputMode="decimal" value={purQty} onChange={(e) => setPurQty(e.target.value)} />
                  <Input
                    label="Purchase amount (optional)"
                    inputMode="decimal"
                    value={purAmount}
                    onChange={(e) => setPurAmount(e.target.value)}
                    placeholder="Adds to total supplier cost"
                  />
                  <label className="block">
                    <div className="mb-1 text-sm font-medium">Note (optional)</div>
                    <textarea
                      className="min-h-[72px] w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm"
                      value={purNote}
                      onChange={(e) => setPurNote(e.target.value)}
                    />
                  </label>
                  <Button isLoading={purSaving} onClick={() => void submitPurchase()}>
                    Record purchase
                  </Button>
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-sm font-semibold">Record usage (reduce stock)</div>
                <div className="mt-3 space-y-3">
                  <Input label="Quantity used" inputMode="decimal" value={useQty} onChange={(e) => setUseQty(e.target.value)} />
                  <label className="block">
                    <div className="mb-1 text-sm font-medium">Note (optional)</div>
                    <textarea
                      className="min-h-[72px] w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm"
                      value={useNote}
                      onChange={(e) => setUseNote(e.target.value)}
                    />
                  </label>
                  <Button variant="secondary" isLoading={useSaving} onClick={() => void submitUsage()}>
                    Record usage
                  </Button>
                </div>
              </Card>
            </div>
          ) : (
            <Card className="p-4 text-sm text-black/70">
              This material uses status-only tracking. Adjust stock level and details from the main inventory list (Edit).
            </Card>
          )}

          <Card className="p-4">
            <div className="text-sm font-semibold">Supplier payments</div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Input label="Amount" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              <Input label="Paid at" type="datetime-local" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              <Input label="Note (optional)" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            </div>
            <div className="mt-3">
              <Button isLoading={paySaving} onClick={() => void submitPayment()}>
                Record payment
              </Button>
            </div>
            <div className="mt-4 max-h-[240px] overflow-auto rounded-xl border border-black/10">
              {payLoading ? (
                <div className="p-3 text-sm text-black/60">Loading…</div>
              ) : payList.length === 0 ? (
                <div className="p-3 text-sm text-black/60">No payments yet.</div>
              ) : (
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-black/10">
                      <th className="px-2 py-2">When</th>
                      <th className="px-2 py-2">Amount</th>
                      <th className="px-2 py-2">Note</th>
                      <th className="px-2 py-2">By</th>
                      {auth.role === "admin" ? <th className="px-2 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {payList.map((p) => (
                      <tr key={p.id} className="border-b border-black/5">
                        <td className="px-2 py-2 whitespace-nowrap">{fmtWhen(p.paid_at)}</td>
                        <td className="px-2 py-2 tabular-nums">{formatMoney(p.amount)}</td>
                        <td className="px-2 py-2">{p.note || "—"}</td>
                        <td className="px-2 py-2">{p.recorded_by || "—"}</td>
                        {auth.role === "admin" ? (
                          <td className="px-2 py-2 text-right">
                            <button
                              type="button"
                              className="font-bold text-red-700 hover:underline"
                              onClick={() => void removePayment(p.id)}
                            >
                              Remove
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Movement history</div>
              <Button variant="secondary" type="button" onClick={() => void loadMovements()}>
                Refresh
              </Button>
            </div>
            <div className="mt-3 max-h-[360px] overflow-auto rounded-xl border border-black/10">
              {moveLoading ? (
                <div className="p-3 text-sm text-black/60">Loading…</div>
              ) : movements.length === 0 ? (
                <div className="p-3 text-sm text-black/60">No movements.</div>
              ) : (
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-black/10">
                      <th className="px-2 py-2">When</th>
                      <th className="px-2 py-2">Action</th>
                      <th className="px-2 py-2">Δ Qty</th>
                      <th className="px-2 py-2">Detail</th>
                      <th className="px-2 py-2">User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id} className="border-b border-black/5">
                        <td className="px-2 py-2 whitespace-nowrap">{fmtWhen(m.created_at)}</td>
                        <td className="px-2 py-2 capitalize">{m.action}</td>
                        <td className="px-2 py-2 tabular-nums">
                          {m.quantity_delta !== null && m.quantity_delta !== undefined ? String(m.quantity_delta) : "—"}
                        </td>
                        <td className="px-2 py-2 text-black/70">{movementDetailText(m)}</td>
                        <td className="px-2 py-2">{m.actor_username || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="Remove payment"
        message="Remove this payment entry?"
        busy={confirmBusy}
        onClose={() => (confirmBusy ? null : setConfirmOpen(false))}
        onConfirm={() => {
          const act = confirmAction;
          if (!act) return;
          setConfirmBusy(true);
          void act()
            .catch((e) => toast.push("error", getErrorMessage(e)))
            .finally(() => {
              setConfirmBusy(false);
              setConfirmOpen(false);
              setConfirmAction(null);
            });
        }}
      />
    </div>
  );
}
