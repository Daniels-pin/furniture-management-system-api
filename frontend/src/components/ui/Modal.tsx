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
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6 sm:pt-10">
      <button
        type="button"
        className="absolute inset-0 z-0 bg-black/40"
        aria-label="Close modal"
        onClick={onClose}
      />
      <div className="relative z-10 flex w-full min-h-0 max-w-[min(720px,calc(100vw-1.5rem))] flex-col">
        <div className="flex max-h-[min(calc(100dvh-1.5rem),900px)] min-h-0 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-soft sm:rounded-3xl md:max-h-[calc(100dvh-5rem)]">
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
            <div className="min-w-0 text-base font-semibold">{title}</div>
            <button
              type="button"
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl px-3 text-sm font-semibold text-black/70 hover:bg-black/5"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-6 sm:pb-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

