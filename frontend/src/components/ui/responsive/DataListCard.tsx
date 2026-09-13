import type { ReactNode, KeyboardEvent, MouseEvent } from "react";

type DataListCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  metrics?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
};

/**
 * Mobile list row card — matches existing Apple-inspired card styling across list pages.
 */
export function DataListCard({
  title,
  subtitle,
  badge,
  metrics,
  actions,
  onClick,
  className = "",
  children
}: DataListCardProps) {
  const interactive = Boolean(onClick);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!onClick) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onClick();
  }

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (!onClick) return;
    const target = e.target as HTMLElement;
    if (target.closest('a,button,input,select,textarea,label,[role="button"]')) return;
    onClick();
  }

  return (
    <div
      className={[
        "rounded-2xl border border-black/10 bg-white p-4",
        interactive ? "cursor-pointer hover:bg-black/[0.01]" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      role={interactive ? "link" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{title}</div>
          {subtitle ? <div className="mt-1 truncate text-xs font-semibold text-black/55">{subtitle}</div> : null}
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>

      {metrics ? <div className="mt-3 grid grid-cols-2 gap-2 text-xs">{metrics}</div> : null}
      {children}
      {actions ? (
        <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function DataListMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-black/45">{label}</div>
      <div className="mt-0.5 font-semibold text-black/85">{value}</div>
    </div>
  );
}
