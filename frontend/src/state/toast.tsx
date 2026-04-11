import React, { createContext, useCallback, useContext, useMemo, useReducer } from "react";

export type ToastKind = "success" | "error" | "info";
export type Toast = { id: string; kind: ToastKind; message: string };

type ToastContextValue = {
  push(kind: ToastKind, message: string): void;
  remove(id: string): void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

type ToastAction =
  | { type: "add"; id: string; kind: ToastKind; message: string }
  | { type: "remove"; id: string };

function toastReducer(state: Toast[], action: ToastAction): Toast[] {
  if (action.type === "add") {
    return [...state, { id: action.id, kind: action.kind, message: action.message }];
  }
  return state.filter((x) => x.id !== action.id);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = uid();
    dispatch({ type: "add", id, kind, message });
    window.setTimeout(() => {
      dispatch({ type: "remove", id });
    }, 3500);
  }, []);

  const remove = useCallback((id: string) => {
    dispatch({ type: "remove", id });
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ push, remove }), [push, remove]);

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

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
