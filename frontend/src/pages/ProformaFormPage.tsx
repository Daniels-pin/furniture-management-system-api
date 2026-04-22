import { Fragment, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { proformaApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import type { ProformaPayload } from "../types/api";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";
import { consumeDraftRecoveryIntent } from "../state/drafts";
import { draftsApi } from "../services/endpoints";

type Line = {
  key: string;
  line_type: "item" | "subheading";
  item_name: string;
  description: string;
  quantity: string;
  amount: string;
};

function newItemLine(): Line {
  return { key: crypto.randomUUID(), line_type: "item", item_name: "", description: "", quantity: "1", amount: "" };
}

function newSubheadingLine(): Line {
  return { key: crypto.randomUUID(), line_type: "subheading", item_name: "", description: "", quantity: "", amount: "" };
}

function isoToDateInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function ProformaFormPage() {
  const { proformaId } = useParams();
  const editId = proformaId ? Number(proformaId) : NaN;
  const isEdit = Number.isFinite(editId);
  const nav = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(isEdit);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [discountType, setDiscountType] = useState<"" | "fixed" | "percentage">("");
  const [discountValue, setDiscountValue] = useState("");
  const [tax, setTax] = useState("");
  const [lines, setLines] = useState<Line[]>([newItemLine()]);
  const [saving, setSaving] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoverLoading, setRecoverLoading] = useState(false);

  const localKey = "draft_v1:proforma";

  async function restoreDraft() {
    setRecoverLoading(true);
    try {
      const res = await draftsApi.get<any>("proforma");
      const d = res?.data || {};
      setCustomerName(String(d.customerName ?? ""));
      setPhone(String(d.phone ?? ""));
      setAddress(String(d.address ?? ""));
      setEmail(String(d.email ?? ""));
      setDueDate(String(d.dueDate ?? ""));
      const dt = d.discountType;
      setDiscountType(dt === "fixed" || dt === "percentage" ? dt : "");
      setDiscountValue(String(d.discountValue ?? ""));
      setTax(String(d.tax ?? ""));
      if (Array.isArray(d.lines) && d.lines.length) {
        setLines(
          d.lines.map((it: any) => ({
            key: crypto.randomUUID(),
            line_type: it?.line_type === "subheading" ? "subheading" : "item",
            item_name: String(it?.item_name ?? ""),
            description: String(it?.description ?? ""),
            quantity: String(it?.quantity ?? "1"),
            amount: String(it?.amount ?? "")
          }))
        );
      }
      try {
        localStorage.setItem(localKey, JSON.stringify(d));
      } catch {
        // ignore
      }
      toast.push("success", "Draft restored");
    } catch (e) {
      try {
        const raw = localStorage.getItem(localKey);
        const d = raw ? JSON.parse(raw) : null;
        if (d) {
          setCustomerName(String(d.customerName ?? ""));
          setPhone(String(d.phone ?? ""));
          setAddress(String(d.address ?? ""));
          setEmail(String(d.email ?? ""));
          setDueDate(String(d.dueDate ?? ""));
          const dt = d.discountType;
          setDiscountType(dt === "fixed" || dt === "percentage" ? dt : "");
          setDiscountValue(String(d.discountValue ?? ""));
          setTax(String(d.tax ?? ""));
          if (Array.isArray(d.lines) && d.lines.length) {
            setLines(
              d.lines.map((it: any) => ({
                key: crypto.randomUUID(),
                line_type: it?.line_type === "subheading" ? "subheading" : "item",
                item_name: String(it?.item_name ?? ""),
                description: String(it?.description ?? ""),
                quantity: String(it?.quantity ?? "1"),
                amount: String(it?.amount ?? "")
              }))
            );
          }
          toast.push("success", "Draft restored");
        } else {
          throw e;
        }
      } catch (e2) {
        toast.push("error", getErrorMessage(e2));
      }
    } finally {
      setRecoverLoading(false);
    }
  }

  async function discardDraft() {
    setRecoverLoading(true);
    try {
      await draftsApi.remove("proforma");
    } catch {
      // ignore
    }
    try {
      localStorage.removeItem(localKey);
    } catch {
      // ignore
    }
    setRecoverLoading(false);
    toast.push("success", "Draft discarded");
  }

  useEffect(() => {
    if (isEdit) return;
    const intent = consumeDraftRecoveryIntent();
    if (intent === "proforma") {
      void restoreDraft();
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await draftsApi.get("proforma");
        if (!alive) return;
        if (res?.data) setRecoverOpen(true);
      } catch {
        try {
          const raw = localStorage.getItem(localKey);
          if (raw) setRecoverOpen(true);
        } catch {
          // ignore
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

  useEffect(() => {
    if (isEdit) return;
    const payload = {
      customerName,
      phone,
      address,
      email,
      dueDate,
      discountType,
      discountValue,
      tax,
      lines
    };
    try {
      localStorage.setItem(localKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
    const t = window.setTimeout(() => {
      void draftsApi.upsert("proforma", payload as any).catch(() => {});
    }, 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, customerName, phone, address, email, dueDate, discountType, discountValue, tax, lines]);

  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const d = await proformaApi.get(editId);
        if (!alive) return;
        if (d.status === "converted") {
          toast.push("error", "This proforma was already converted.");
          nav(`/proforma/${editId}`);
          return;
        }
        setCustomerName(d.customer_name ?? "");
        setPhone(d.phone ?? "");
        setAddress(d.address ?? "");
        setEmail(d.email ?? "");
        setDueDate(isoToDateInput(d.due_date));
        const dt = d.discount_type;
        setDiscountType(dt === "fixed" || dt === "percentage" ? dt : "");
        setDiscountValue(d.discount_value != null ? String(d.discount_value) : "");
        setTax(d.tax_percent != null ? String(d.tax_percent) : "");
        if (d.items?.length) {
          setLines(
            d.items.map((it) => ({
              key: crypto.randomUUID(),
              line_type: ((it as any).line_type ?? "item") as any,
              item_name: it.item_name ?? "",
              description: (it.description as string) ?? "",
              quantity: String(it.quantity ?? 1),
              amount: it.amount != null ? String(it.amount) : ""
            }))
          );
        }
      } catch (e) {
        toast.push("error", getErrorMessage(e));
        nav("/proforma");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [editId, isEdit, nav, toast]);

  function addLine() {
    setLines((xs) => [...xs, newItemLine()]);
  }

  function addLineAfter(index: number) {
    setLines((xs) => [...xs.slice(0, index + 1), newItemLine(), ...xs.slice(index + 1)]);
  }

  function addSubheading() {
    setLines((xs) => [...xs, newSubheadingLine()]);
  }

  function removeLine(i: number) {
    setLines((xs) => (xs.length <= 1 ? xs : xs.filter((_, j) => j !== i)));
  }

  function buildPayload(saveAsDraft: boolean): ProformaPayload {
    const items: ProformaPayload["items"] = [];
    for (const ln of lines) {
      const name = ln.item_name.trim();
      // Never send empty rows to the API (prevents validation failures on drafts).
      if (!name) continue;

      if (ln.line_type === "subheading") {
        items.push({
          line_type: "subheading",
          item_name: name,
          description: "",
          quantity: 0,
          amount: null
        });
        continue;
      }

      const q = Number(ln.quantity);
      const amt = parseMoneyInput(ln.amount);
      items.push({
        line_type: "item",
        item_name: name,
        description: ln.description.trim(),
        quantity: Number.isFinite(q) && q > 0 ? Math.floor(q) : 1,
        amount: amt !== null && Number.isFinite(amt) && amt >= 0 ? amt : null
      });
    }
    const dv = parseMoneyInput(discountValue);
    const tx = parseMoneyInput(tax);
    return {
      customer_name: customerName.trim(),
      phone: phone.trim(),
      address: address.trim(),
      email: email.trim() || undefined,
      due_date: dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : undefined,
      items,
      discount_type: discountType === "" ? undefined : discountType,
      discount_value: dv !== null && Number.isFinite(dv) ? dv : null,
      tax: tx !== null && Number.isFinite(tx) ? tx : null,
      save_as_draft: saveAsDraft
    };
  }

  async function submit(saveAsDraft: boolean) {
    if (!customerName.trim() || !phone.trim() || !address.trim()) {
      toast.push("error", "Customer name, phone, and address are required.");
      return;
    }
    const named = lines.filter((l) => l.item_name.trim());
    if (named.length === 0) {
      toast.push("error", "Add at least one line item with a name.");
      return;
    }
    for (const ln of named) {
      if (ln.line_type === "subheading") continue;
      const amt = parseMoneyInput(ln.amount);
      if (ln.amount.trim() === "" || amt === null || !Number.isFinite(amt) || amt < 0) {
        toast.push("error", "Enter a valid amount (≥ 0) for each line item.");
        return;
      }
      if (!isValidThousandsCommaNumber(ln.amount)) {
        toast.push("error", "Fix comma formatting in amount fields (e.g. 1,000).");
        return;
      }
    }
    if (discountValue.trim() && !isValidThousandsCommaNumber(discountValue)) {
      toast.push("error", "Fix comma formatting in discount value (e.g. 1,000).");
      return;
    }
    if (tax.trim() && !isValidThousandsCommaNumber(tax)) {
      toast.push("error", "Fix comma formatting in tax (e.g. 7.5 or 1,000).");
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload(saveAsDraft);
      const out = isEdit ? await proformaApi.update(editId, payload) : await proformaApi.create(payload);
      toast.push(
        "success",
        isEdit ? (saveAsDraft ? "Draft saved." : "Proforma updated.") : saveAsDraft ? "Draft created." : "Proforma created."
      );
      if (!isEdit) {
        try {
          await draftsApi.remove("proforma");
        } catch {
          // ignore
        }
        try {
          localStorage.removeItem(localKey);
        } catch {
          // ignore
        }
      }
      nav(`/proforma/${out.id}`);
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <div className="text-sm text-black/60">Loading…</div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Modal
        open={recoverOpen}
        title="Unfinished Proforma"
        onClose={() => {
          // force explicit choice
        }}
      >
        <div className="space-y-4">
          <div className="text-sm text-black/70">
            You have an unfinished <span className="font-semibold">Proforma</span>. Do you want to continue where you left off?
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              isLoading={recoverLoading}
              onClick={async () => {
                await discardDraft();
                setRecoverOpen(false);
              }}
            >
              Discard
            </Button>
            <Button
              isLoading={recoverLoading}
              onClick={async () => {
                await restoreDraft();
                setRecoverOpen(false);
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      </Modal>
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">{isEdit ? "Edit proforma" : "New proforma invoice"}</div>
        </div>
        <Button variant="secondary" onClick={() => nav(isEdit ? `/proforma/${editId}` : "/proforma")}>
          Cancel
        </Button>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input label="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          <Input label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Due date (optional)" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <div className="md:col-span-2">
            <Input label="Address" value={address} onChange={(e) => setAddress(e.target.value)} required />
          </div>
        </div>

        <div className="mt-6 border-t border-black/10 pt-6">
          <div className="text-sm font-semibold text-black">Line items</div>
          <div className="mt-3 space-y-3">
            {lines.map((ln, i) => (
              <Fragment key={ln.key}>
                <div className="grid grid-cols-1 gap-2 rounded-2xl border border-black/10 p-3 md:grid-cols-12 md:items-end">
                  <div className={ln.line_type === "subheading" ? "md:col-span-11" : "md:col-span-3"}>
                    <Input
                      label="Item"
                      value={ln.item_name}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLines((xs) => xs.map((x, j) => (j === i ? { ...x, item_name: v } : x)));
                      }}
                    />
                  </div>
                  {ln.line_type !== "subheading" ? (
                    <div className="md:col-span-4">
                      <Input
                        label="Description"
                        value={ln.description}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLines((xs) => xs.map((x, j) => (j === i ? { ...x, description: v } : x)));
                        }}
                      />
                    </div>
                  ) : null}
                  {ln.line_type !== "subheading" ? (
                    <div className="md:col-span-2">
                      <Input
                        label="Qty"
                        inputMode="numeric"
                        value={ln.quantity}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLines((xs) => xs.map((x, j) => (j === i ? { ...x, quantity: v } : x)));
                        }}
                      />
                    </div>
                  ) : null}
                  {ln.line_type !== "subheading" ? (
                    <div className="md:col-span-2">
                      <Input
                        label="Amount (unit)"
                        inputMode="decimal"
                        value={ln.amount}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLines((xs) => xs.map((x, j) => (j === i ? { ...x, amount: v } : x)));
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="md:col-span-1 flex justify-end pb-2">
                    <Button type="button" variant="ghost" onClick={() => removeLine(i)}>
                      Remove
                    </Button>
                  </div>
                </div>
                {ln.line_type === "subheading" ? (
                  <div className="flex flex-wrap gap-2 pl-1">
                    <Button type="button" variant="secondary" onClick={() => addLineAfter(i)}>
                      Add line
                    </Button>
                  </div>
                ) : null}
              </Fragment>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={addLine}>
              Add line
            </Button>
            <Button type="button" variant="secondary" onClick={addSubheading}>
              Add subheading
            </Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-black/10 pt-6 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-black/60">Discount type</label>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-semibold"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as "" | "fixed" | "percentage")}
            >
              <option value="">None</option>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed</option>
            </select>
          </div>
          <Input
            label="Discount value"
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            placeholder={discountType === "percentage" ? "e.g. 10" : "Amount"}
            error={discountValue.trim() && !isValidThousandsCommaNumber(discountValue) ? "Invalid comma formatting" : undefined}
          />
          <Input
            label="Tax %"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
            placeholder="e.g. 7.5"
            error={tax.trim() && !isValidThousandsCommaNumber(tax) ? "Invalid comma formatting" : undefined}
          />
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          <Button isLoading={saving} onClick={() => void submit(true)}>
            Save as draft
          </Button>
          <Button isLoading={saving} variant="secondary" onClick={() => void submit(false)}>
            {isEdit ? "Save & finalize" : "Create (finalized)"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
