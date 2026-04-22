import { createContext, useContext, useEffect, useMemo, useState } from "react";

type PageHeaderState = {
  title: string;
  subtitle?: string | null;
};

type PageHeaderApi = {
  header: PageHeaderState | null;
  setHeader(next: PageHeaderState | null): void;
};

const Ctx = createContext<PageHeaderApi | null>(null);

export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [header, setHeader] = useState<PageHeaderState | null>(null);

  const value = useMemo<PageHeaderApi>(() => ({ header, setHeader }), [header]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageHeader(next: PageHeaderState | null) {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePageHeader must be used within PageHeaderProvider");

  // Keep the layout header stable across tab navigation without remount flicker.
  useEffect(() => {
    ctx.setHeader(next);
    return () => {
      ctx.setHeader((prev) => {
        if (!next) return prev;
        if (!prev) return prev;
        return prev.title === next.title ? null : prev;
      });
    };
    // Intentionally depend on primitive fields so updates are predictable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next?.title, next?.subtitle]);
}

export function usePageHeaderState() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePageHeaderState must be used within PageHeaderProvider");
  return ctx.header;
}

