import type { EmployeeSignOutPreview } from "../../types/api";
import { formatMoney } from "../../utils/money";
import { ConfirmModal } from "../ui/ConfirmModal";

type Props = {
  open: boolean;
  busy?: boolean;
  preview: EmployeeSignOutPreview | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function AttendanceSignOutConfirmModal({ open, busy = false, preview, onClose, onConfirm }: Props) {
  if (!preview) return null;

  return (
    <ConfirmModal
      open={open}
      title="Confirm sign out"
      message={
        <div className="space-y-2 text-sm text-black/80">
          {preview.shift_label ? (
            <p>
              <span className="font-semibold">Today&apos;s shift:</span> {preview.shift_label}
            </p>
          ) : null}
          <p>
            <span className="font-semibold">Closing time:</span> {preview.closing_time}
          </p>
          <p>
            <span className="font-semibold">Current time:</span> {preview.current_time}
          </p>
          {preview.is_early_sign_out ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">
              This will be recorded as an early sign-out
              {Number(preview.early_sign_out_fee_naira) > 0
                ? ` and a deduction of ${formatMoney(preview.early_sign_out_fee_naira)} may apply.`
                : "."}
            </p>
          ) : (
            <p className="text-black/60">{preview.message}</p>
          )}
        </div>
      }
      busy={busy}
      confirmLabel="Confirm sign out"
      cancelLabel="Cancel"
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
