import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { expensesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import type { ExpenseEntry, ExpenseEntryType, ExpenseSummary } from "../types/api";
import { formatMoney } from "../utils/money";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";
import { usePageHeader } from "../components/layout/pageHeader";

export function ExpensesPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ExpenseEntry[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [offset, setOffset] = useState(0);
  const pageLimit = 20;
  const [total, setTotal] = useState(0);

  usePageHeader({
    title: "Expense / Petty Cash",
    subtitle: "Admin and Finance can add, edit, and delete entries. Summaries update immediately."
  });

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [entryType, setEntryType] = useState<ExpenseEntryType>("expense");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [receiptFor, setReceiptFor] = useState<ExpenseEntry | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<ExpenseEntry | null>(null);

  const [editFor, setEditFor] = useState<ExpenseEntry | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editType, setEditType] = useState<ExpenseEntryType>("expense");
  const [editNote, setEditNote] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [deleteFor, setDeleteFor] = useState<ExpenseEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canPreview = useMemo(() => Boolean(previewUrl), [previewUrl]);

  async function refresh(next?: { offset?: number }) {
    const nextOffset = typeof next?.offset === "number" ? next.offset : offset;
    const [page, sum] = await Promise.all([expensesApi.page({ limit: pageLimit, offset: nextOffset }), expensesApi.summary()]);
    setRows(page.items);
    setTotal(page.total ?? 0);
    setOffset(page.offset ?? nextOffset);
    setSummary(sum);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await refresh({ offset: 0 });
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  function isInteractiveTarget(target: EventTarget | null): boolean {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    return Boolean(el.closest('a,button,input,select,textarea,label,[role="button"],[role="checkbox"]'));
  }

  const page = Math.floor(offset / pageLimit) + 1;
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageLimit));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Total Received (credits)</div>
          <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary?.total_received ?? 0)}</div>
        </Card>
        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Total Expenses</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-red-800">{formatMoney(summary?.total_expenses ?? 0)}</div>
        </Card>
        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Balance</div>
          <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary?.balance ?? 0)}</div>
        </Card>
        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Today’s expenses</div>
          <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary?.today_total ?? 0)}</div>
        </Card>
      </div>

      <Card>
        <div className="text-sm font-semibold text-black">New entry</div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end">
          <Input label="Date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          <div>
            <label className="mb-1 block text-xs font-semibold text-black/60">Type</label>
            <select
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={entryType}
              onChange={(e) => setEntryType(e.target.value as ExpenseEntryType)}
            >
              <option value="expense">Expense</option>
              <option value="credit">Credit</option>
            </select>
          </div>
          <Input
            label="Amount (NGN)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0"
          />
          <Button
            isLoading={saving}
            onClick={() => {
              const amt = parseMoneyInput(amount);
              if (amount.trim() && !isValidThousandsCommaNumber(amount)) {
                toast.push("error", "Fix comma formatting in amount.");
                return;
              }
              if (!entryDate) {
                toast.push("error", "Pick a date.");
                return;
              }
              if (amt === null || Number.isNaN(amt) || amt <= 0) {
                toast.push("error", "Enter a valid amount (> 0).");
                return;
              }
              setSaving(true);
              void expensesApi
                .create({
                  entry_date: new Date(entryDate + "T12:00:00").toISOString(),
                  amount: amt,
                  entry_type: entryType,
                  note: note.trim() || null
                })
                .then(() => refresh())
                .then(() => {
                  setAmount("");
                  setNote("");
                  toast.push("success", "Entry added.");
                })
                .catch((e) => toast.push("error", getErrorMessage(e)))
                .finally(() => setSaving(false));
            }}
          >
            Add
          </Button>
        </div>
        <div className="mt-3">
          <Input label="Note / description (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Card>

      <Card>
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-black">Entries</div>
            <div className="mt-1 text-xs text-black/55">No deletions; upload receipts per entry.</div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void expensesApi
                  .exportCsv()
                  .then(() => toast.push("success", "Export downloaded."))
                  .catch((e) => toast.push("error", getErrorMessage(e)));
              }}
            >
              Export CSV
            </Button>
            <Button
              variant="secondary"
              isLoading={loading}
              onClick={() => {
                setLoading(true);
                void refresh()
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setLoading(false));
              }}
            >
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="mt-3 text-sm text-black/60">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="mt-3 text-sm text-black/60">No entries yet.</div>
        ) : (
          <>
            <div className="mt-3 md:hidden space-y-3">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="cursor-pointer rounded-2xl border border-black/10 bg-white p-4 hover:bg-black/[0.03]"
                  role="link"
                  tabIndex={0}
                  onClick={() => setDetailFor(r)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    setDetailFor(r);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-black/55">{new Date(r.entry_date).toLocaleDateString()}</div>
                      <div className="mt-1">
                        <span
                          className={[
                            "rounded-full px-2 py-0.5 text-xs font-semibold",
                            r.entry_type === "credit" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"
                          ].join(" ")}
                        >
                          {r.entry_type === "credit" ? "Credit" : "Expense"}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-black/55">Amount</div>
                      <div className="mt-0.5 text-base font-bold tabular-nums">
                        {r.entry_type === "expense" ? "−" : "+"}
                        {formatMoney(r.amount)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="text-xs font-semibold text-black/55">Note</div>
                    <div className="mt-1 text-sm text-black/70 break-words">{r.note ?? "—"}</div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {r.receipt_url ? (
                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewUrl(r.receipt_url ?? null);
                        }}
                      >
                        Preview receipt
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReceiptFor(r);
                        }}
                      >
                        Upload receipt
                      </Button>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditFor(r);
                          setEditAmount(String(r.amount ?? ""));
                          setEditType(r.entry_type);
                          setEditNote(r.note ?? "");
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteFor(r);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                    <div className="text-right text-xs font-semibold text-black/45">
                      {r.processed_by ? `${r.processed_by} • ` : ""}
                      {r.processed_by_role ?? "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 hidden md:block min-w-0 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="text-black/60">
                <tr className="border-b border-black/10">
                  <th className="py-3 pr-4 font-semibold">Date</th>
                  <th className="py-3 pr-4 font-semibold">Type</th>
                  <th className="py-3 pr-4 text-right font-semibold">Amount</th>
                  <th className="py-3 pr-4 font-semibold">Note</th>
                  <th className="py-3 pr-4 font-semibold">Receipt</th>
                  <th className="py-3 pr-4 font-semibold">Confirmed by</th>
                  <th className="py-3 pr-0 text-right font-semibold"> </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-black/5 cursor-pointer hover:bg-black/[0.03]"
                    role="link"
                    tabIndex={0}
                    onClick={(e) => {
                      if (isInteractiveTarget(e.target)) return;
                      setDetailFor(r);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      setDetailFor(r);
                    }}
                  >
                    <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                      {new Date(r.entry_date).toLocaleDateString()}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          r.entry_type === "credit" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"
                        ].join(" ")}
                      >
                        {r.entry_type === "credit" ? "Credit" : "Expense"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-right font-bold tabular-nums">
                      {r.entry_type === "expense" ? "−" : "+"}
                      {formatMoney(r.amount)}
                    </td>
                    <td className="py-3 pr-4 text-xs text-black/60">{r.note ?? "—"}</td>
                    <td className="py-3 pr-4">
                      {r.receipt_url ? (
                        <button
                          type="button"
                          className="text-sm font-semibold text-black underline decoration-black/30 underline-offset-2"
                          onClick={() => setPreviewUrl(r.receipt_url ?? null)}
                        >
                          Preview
                        </button>
                      ) : (
                        <Button variant="secondary" onClick={() => setReceiptFor(r)}>
                          Upload
                        </Button>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs font-semibold text-black/60">
                      {r.processed_by ? r.processed_by : "—"} {r.processed_by_role ? `(${r.processed_by_role})` : ""}
                    </td>
                    <td className="py-3 pr-0 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="text-sm font-semibold text-black underline decoration-black/30 underline-offset-2"
                          onClick={() => {
                            setEditFor(r);
                            setEditAmount(String(r.amount ?? ""));
                            setEditType(r.entry_type);
                            setEditNote(r.note ?? "");
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-sm font-semibold text-red-700 underline decoration-red-700/30 underline-offset-2"
                          onClick={() => setDeleteFor(r)}
                        >
                          Delete
                        </button>
                      </div>
                      <div className="mt-1 text-xs text-black/50">{r.processed_by_role ?? "—"}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="text-xs font-semibold text-black/55">
                Page {page} of {totalPages}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={offset <= 0 || loading}
                  onClick={() => {
                    const next = Math.max(0, offset - pageLimit);
                    setLoading(true);
                    void refresh({ offset: next })
                      .catch((e) => toast.push("error", getErrorMessage(e)))
                      .finally(() => setLoading(false));
                  }}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={offset + pageLimit >= total || loading}
                  onClick={() => {
                    const next = offset + pageLimit;
                    setLoading(true);
                    void refresh({ offset: next })
                      .catch((e) => toast.push("error", getErrorMessage(e)))
                      .finally(() => setLoading(false));
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <Modal open={receiptFor !== null} title="Upload receipt" onClose={() => (receiptBusy ? null : setReceiptFor(null))}>
        {receiptFor ? (
          <div className="space-y-3">
            <div className="text-sm text-black/70">
              Entry #{receiptFor.id} • {new Date(receiptFor.entry_date).toLocaleDateString()} • {formatMoney(receiptFor.amount)}
            </div>
            <input
              type="file"
              className="block text-sm"
              disabled={receiptBusy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setReceiptBusy(true);
                void expensesApi
                  .uploadReceipt(receiptFor.id, f)
                  .then(() => refresh())
                  .then(() => toast.push("success", "Receipt uploaded."))
                  .then(() => setReceiptFor(null))
                  .catch((er) => toast.push("error", getErrorMessage(er)))
                  .finally(() => setReceiptBusy(false));
              }}
            />
            <div className="text-xs text-black/50">Receipts are stored on Cloudinary and cannot be replaced.</div>
          </div>
        ) : null}
      </Modal>

      <Modal open={canPreview} title="Receipt preview" onClose={() => setPreviewUrl(null)}>
        {previewUrl ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-black/10 overflow-hidden">
              <iframe title="Receipt preview" src={previewUrl} className="h-[70dvh] w-full" />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={detailFor !== null} title="Entry details" onClose={() => setDetailFor(null)}>
        {detailFor ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-black/10 bg-white p-3 text-sm">
              <div className="text-xs font-semibold text-black/55">Date/time</div>
              <div className="mt-0.5 font-bold">{new Date(detailFor.entry_date).toLocaleString()}</div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-black/55">Type</div>
                  <div className="mt-0.5 font-semibold">{detailFor.entry_type === "credit" ? "Credit" : "Expense"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-black/55">Amount</div>
                  <div className="mt-0.5 font-extrabold tabular-nums">
                    {detailFor.entry_type === "expense" ? "−" : "+"}
                    {formatMoney(detailFor.amount)}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <div className="text-xs font-semibold text-black/55">Confirmed by</div>
                <div className="mt-0.5 font-semibold">
                  {detailFor.processed_by ? detailFor.processed_by : "—"} {detailFor.processed_by_role ? `(${detailFor.processed_by_role})` : ""}
                </div>
              </div>
              <div className="mt-3">
                <div className="text-xs font-semibold text-black/55">Note</div>
                <div className="mt-1 text-sm text-black/70 break-words">{detailFor.note ?? "—"}</div>
              </div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white p-3 text-sm">
              <div className="text-xs font-semibold text-black/55">Receipt</div>
              <div className="mt-2">
                {detailFor.receipt_url ? (
                  <Button variant="secondary" onClick={() => setPreviewUrl(detailFor.receipt_url ?? null)}>
                    Preview receipt
                  </Button>
                ) : (
                  <div className="text-sm text-black/60">No receipt uploaded.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={editFor !== null} title="Edit entry" onClose={() => (editSaving ? null : setEditFor(null))}>
        {editFor ? (
          <div className="space-y-4">
            <div className="text-sm text-black/70">
              Entry #{editFor.id} • {new Date(editFor.entry_date).toLocaleDateString()}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-black/60">Type</label>
              <select
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                value={editType}
                onChange={(e) => setEditType(e.target.value as ExpenseEntryType)}
              >
                <option value="expense">Expense</option>
                <option value="credit">Credit</option>
              </select>
            </div>
            <label className="text-xs font-semibold text-black/60">
              Amount (NGN)
              <input
                className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </label>
            <label className="text-xs font-semibold text-black/60">
              Note / description (optional)
              <input
                className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                isLoading={editSaving}
                onClick={() => {
                  const amt = parseMoneyInput(editAmount);
                  if (editAmount.trim() && !isValidThousandsCommaNumber(editAmount)) {
                    toast.push("error", "Fix comma formatting in amount.");
                    return;
                  }
                  if (amt === null || Number.isNaN(amt) || amt <= 0) {
                    toast.push("error", "Enter a valid amount (> 0).");
                    return;
                  }
                  setEditSaving(true);
                  void expensesApi
                    .update(editFor.id, { amount: amt, entry_type: editType, note: editNote.trim() || null })
                    .then(() => refresh())
                    .then(() => toast.push("success", "Entry updated."))
                    .then(() => setEditFor(null))
                    .catch((e) => toast.push("error", getErrorMessage(e)))
                    .finally(() => setEditSaving(false));
                }}
              >
                Save
              </Button>
              <Button variant="ghost" disabled={editSaving} onClick={() => setEditFor(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={deleteFor !== null} title="Delete entry?" onClose={() => (deleting ? null : setDeleteFor(null))}>
        {deleteFor ? (
          <div className="space-y-4">
            <div className="text-sm text-black/70">
              Are you sure you want to delete entry #{deleteFor.id} ({new Date(deleteFor.entry_date).toLocaleDateString()} •{" "}
              {formatMoney(deleteFor.amount)})?
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                isLoading={deleting}
                onClick={() => {
                  setDeleting(true);
                  void expensesApi
                    .remove(deleteFor.id)
                    .then(() => refresh())
                    .then(() => toast.push("success", "Entry deleted."))
                    .then(() => setDeleteFor(null))
                    .catch((e) => toast.push("error", getErrorMessage(e)))
                    .finally(() => setDeleting(false));
                }}
              >
                Delete
              </Button>
              <Button variant="ghost" disabled={deleting} onClick={() => setDeleteFor(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

