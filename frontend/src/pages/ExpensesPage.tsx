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

  usePageHeader({
    title: "Expense / Petty Cash",
    subtitle: "Admin and Finance can add entries. Records are append-only."
  });

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [entryType, setEntryType] = useState<ExpenseEntryType>("expense");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [receiptFor, setReceiptFor] = useState<ExpenseEntry | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const canPreview = useMemo(() => Boolean(previewUrl), [previewUrl]);

  async function refresh() {
    const [list, sum] = await Promise.all([expensesApi.list(), expensesApi.summary()]);
    setRows(list);
    setSummary(sum);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await refresh();
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
          <div className="mt-3 min-w-0 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="text-black/60">
                <tr className="border-b border-black/10">
                  <th className="py-3 pr-4 font-semibold">Date</th>
                  <th className="py-3 pr-4 font-semibold">Type</th>
                  <th className="py-3 pr-4 text-right font-semibold">Amount</th>
                  <th className="py-3 pr-4 font-semibold">Note</th>
                  <th className="py-3 pr-4 font-semibold">Receipt</th>
                  <th className="py-3 pr-0 text-right font-semibold"> </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-black/5">
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
                    <td className="py-3 pr-0 text-right text-xs text-black/50">{r.processed_by_role ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-black/5"
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in new tab
            </a>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

