import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from "react";
import { Button } from "../components/ui/Button";

export type ToastKind = "success" | "error" | "info";
export type Toast = { id: string; kind: ToastKind; message: string };

export type ActionFeedback = {
  id: string;
  kind: ToastKind;
  message: string;
  buttonLabel: "OK" | "Continue";
};

export type ActionFeedbackOptions = {
  buttonLabel?: "OK" | "Continue";
};

type ToastContextValue = {
  /** Major action outcomes — centered modal, requires acknowledgment. */
  push(kind: ToastKind, message: string, options?: ActionFeedbackOptions): void;
  /** Passive / real-time alerts — top-right toast, auto-dismiss. */
  pushLive(kind: ToastKind, message: string): void;
  remove(id: string): void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const LIVE_TOAST_MS = 3500;

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function kindTitle(kind: ToastKind): string {
  if (kind === "success") return "Success";
  if (kind === "error") return "Error";
  return "Notice";
}

function kindAccent(kind: ToastKind): string {
  if (kind === "success") return "border-emerald-300/80 bg-emerald-50";
  if (kind === "error") return "border-red-300/80 bg-red-50";
  return "border-blue-300/80 bg-blue-50";
}

function kindTitleColor(kind: ToastKind): string {
  if (kind === "success") return "text-emerald-950";
  if (kind === "error") return "text-red-950";
  return "text-blue-950";
}

type State = { live: Toast[]; actions: ActionFeedback[] };

type ReducerAction =
  | { type: "live_add"; id: string; kind: ToastKind; message: string }
  | { type: "live_remove"; id: string }
  | { type: "action_add"; item: ActionFeedback }
  | { type: "action_dismiss"; id: string };

function appReducer(state: State, action: ReducerAction): State {
  switch (action.type) {
    case "live_add":
      return { ...state, live: [...state.live, { id: action.id, kind: action.kind, message: action.message }] };
    case "live_remove":
      return { ...state, live: state.live.filter((x) => x.id !== action.id) };
    case "action_add":
      return { ...state, actions: [...state.actions, action.item] };
    case "action_dismiss":
      return { ...state, actions: state.actions.filter((x) => x.id !== action.id) };
    default:
      return state;
  }
}

function ActionFeedbackModal({ item, onDismiss }: { item: ActionFeedback; onDismiss(): void }) {
  const title = kindTitle(item.kind);

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`action-feedback-title-${item.id}`}
      aria-describedby={`action-feedback-message-${item.id}`}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        className={[
          "relative z-10 w-full max-w-md rounded-3xl border-2 px-6 py-7 text-center shadow-2xl sm:max-w-lg sm:px-8 sm:py-9",
          kindAccent(item.kind)
        ].join(" ")}
      >
        <div
          id={`action-feedback-title-${item.id}`}
          className={["text-2xl font-extrabold tracking-tight sm:text-3xl", kindTitleColor(item.kind)].join(" ")}
        >
          {title}
        </div>
        <p
          id={`action-feedback-message-${item.id}`}
          className="mt-4 text-base font-bold leading-snug text-black sm:text-lg"
        >
          {item.message}
        </p>
        <div className="mt-7 flex justify-center">
          <Button className="min-h-12 min-w-[9rem] px-8 text-base font-bold" onClick={onDismiss}>
            {item.buttonLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, { live: [], actions: [] });
  const activeAction = state.actions[0] ?? null;

  const pushLive = useCallback((kind: ToastKind, message: string) => {
    const id = uid();
    dispatch({ type: "live_add", id, kind, message });
    window.setTimeout(() => {
      dispatch({ type: "live_remove", id });
    }, LIVE_TOAST_MS);
  }, []);

  const push = useCallback((kind: ToastKind, message: string, options?: ActionFeedbackOptions) => {
    const id = uid();
    dispatch({
      type: "action_add",
      item: {
        id,
        kind,
        message,
        buttonLabel: options?.buttonLabel ?? "OK"
      }
    });
  }, []);

  const remove = useCallback((id: string) => {
    dispatch({ type: "live_remove", id });
  }, []);

  const dismissAction = useCallback((id: string) => {
    dispatch({ type: "action_dismiss", id });
  }, []);

  useEffect(() => {
    if (!activeAction) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [activeAction]);

  const value = useMemo<ToastContextValue>(() => ({ push, pushLive, remove }), [push, pushLive, remove]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {activeAction ? (
        <ActionFeedbackModal item={activeAction} onDismiss={() => dismissAction(activeAction.id)} />
      ) : null}

      <div className="fixed right-4 top-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
        {state.live.map((t) => (
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
