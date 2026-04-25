import { Modal } from "./Modal";
import { Button } from "./Button";

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  busy = false,
  onConfirm,
  onClose
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <Modal open={open} title={title} onClose={() => (busy ? null : onClose())}>
      <div className="space-y-4">
        <div className="text-sm text-black/70 whitespace-pre-wrap">{message}</div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} isLoading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

