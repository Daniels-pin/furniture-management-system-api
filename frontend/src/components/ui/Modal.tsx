import React, { useEffect } from "react";

export function Modal({
  open,
  title,
  children,
  onClose
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose(): void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      <button
        className="absolute inset-0 bg-black/40"
        aria-label="Close modal"
        onClick={onClose}
      />
      <div className="relative mx-auto mt-16 w-[min(720px,calc(100vw-2rem))]">
        <div className="rounded-3xl border border-black/10 bg-white shadow-soft">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="text-base font-semibold">{title}</div>
            <button
              className="rounded-xl px-2 py-1 text-sm font-semibold text-black/70 hover:bg-black/5"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <div className="px-6 pb-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

