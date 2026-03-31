import React, { createContext, useContext, useMemo, useState } from "react";

export type ToastKind = "success" | "error" | "info";
export type Toast = { id: string; kind: ToastKind; message: string };

type ToastContextValue = {
  toasts: Toast[];
  push(kind: ToastKind, message: string): void;
  remove(id: string): void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      push: (kind, message) => {
        const id = uid();
        setToasts((t) => [...t, { id, kind, message }]);
        window.setTimeout(() => {
          setToasts((t) => t.filter((x) => x.id !== id));
        }, 3500);
      },
      remove: (id) => setToasts((t) => t.filter((x) => x.id !== id))
    }),
    [toasts]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              "rounded-2xl border bg-white px-4 py-3 shadow-soft",
              t.kind === "success" ? "border-black/10" : "",
              t.kind === "error" ? "border-black/20" : "",
              t.kind === "info" ? "border-black/10" : ""
            ].join(" ")}
            role="status"
          >
            <div className="text-sm font-medium">
              {t.kind === "success" ? "Success" : t.kind === "error" ? "Error" : "Info"}
            </div>
            <div className="mt-0.5 text-sm text-black/70">{t.message}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

