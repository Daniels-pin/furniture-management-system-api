import type { ReactNode } from "react";

type PageToolbarProps = {
  /** Search input or primary filter area */
  search?: ReactNode;
  /** Secondary filters — stack below search on mobile */
  filters?: ReactNode;
  /** Action buttons — wrap naturally on small screens */
  actions?: ReactNode;
  className?: string;
};

/**
 * Page header toolbar: search/filters stack vertically on mobile, inline on desktop.
 */
export function PageToolbar({ search, filters, actions, className = "" }: PageToolbarProps) {
  return (
    <div className={["flex flex-col gap-3", className].filter(Boolean).join(" ")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        {search ? <div className="min-w-0 flex-1 sm:min-w-[220px]">{search}</div> : null}
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {filters ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{filters}</div> : null}
    </div>
  );
}
