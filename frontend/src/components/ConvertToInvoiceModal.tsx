import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { formatMoney, parseMoneyNumber } from "../utils/money";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Shown in subtitle, e.g. "quotation" or "proforma invoice" */
  documentLabel: string;
  grandTotal: unknown;
  isSubmitting: boolean;
  onConfirm: (amountPaid: number) => Promise<void>;
};

export function ConvertToInvoiceModal({
  open,
  onClose,
  documentLabel,
  grandTotal,
  isSubmitting,
  onConfirm
}: Props) {
  const [amountStr, setAmountStr] = useState("");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setAmountStr("");
    setError(undefined);
  }, [open]);

  const totalNum = parseMoneyNumber(grandTotal);
  const paidParsed = amountStr.trim() === "" ? 0 : parseMoneyNumber(amountStr);
  const balancePreview =
    totalNum !== null && paidParsed !== null && paidParsed >= 0 ? totalNum - paidParsed : null;

  async function submit() {
    setError(undefined);
    const trimmed = amountStr.trim();
    let paid = 0;
    if (trimmed !== "") {
      const p = parseMoneyNumber(trimmed);
      if (p === null || p < 0) {
        setError("Enter a valid amount (zero or greater), or leave blank for no payment.");
        return;
      }
      paid = p;
    }
    if (totalNum !== null && paid > totalNum + 1e-6) {
      setError(`Amount paid cannot exceed total (${formatMoney(totalNum)}).`);
      return;
    }
    await onConfirm(paid);
  }

  return (
    <Modal open={open} title="Convert to invoice" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-black/70">
          Enter how much the customer has already paid for this {documentLabel}. Leave blank or 0 if none. Balance is
          total minus amount paid.
        </p>
        {totalNum !== null ? (
          <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-black/60">Total</span>
              <span className="font-semibold text-black">{formatMoney(totalNum)}</span>
            </div>
            {balancePreview !== null ? (
              <div className="mt-1 flex justify-between gap-2 border-t border-black/5 pt-1">
                <span className="text-black/60">Balance after payment</span>
                <span className="font-semibold text-black">{formatMoney(Math.max(0, balancePreview))}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-xs text-amber-800">
            Total could not be read from this document; payment limits will be validated on the server.
          </div>
        )}
        <Input
          label="Amount paid by customer"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
          error={error}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" type="button" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" isLoading={isSubmitting} onClick={() => void submit()}>
            Create invoice
          </Button>
        </div>
      </div>
    </Modal>
  );
}
