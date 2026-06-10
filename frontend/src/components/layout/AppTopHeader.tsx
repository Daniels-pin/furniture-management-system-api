import type { ReactNode } from "react";
import { useAuth } from "../../state/auth";
import { IconSearch } from "../dashboard/icons";
import { CompanyLogo } from "./CompanyLogo";

type AppTopHeaderProps = {
  title: string;
  subtitle: string | null;
  hideActions: boolean;
  actions: ReactNode;
};

export function AppTopHeader({ title, subtitle, hideActions, actions }: AppTopHeaderProps) {
  const auth = useAuth();

  return (
    <header className="mb-8 pb-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-3.5 sm:gap-4">
          <CompanyLogo variant="header" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-[1.75rem]">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">{subtitle}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center lg:max-w-xl lg:justify-end">
          <label className="relative flex-1 sm:max-w-xs">
            <span className="sr-only">Search</span>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]">
              <IconSearch size={16} />
            </span>
            <input
              type="search"
              disabled
              placeholder="Search…"
              className="w-full rounded-lg bg-[var(--surface-muted)] py-2 pl-9 pr-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] transition focus:outline-none focus:ring-2 focus:ring-black/10 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Quick search (coming soon)"
            />
          </label>

          <div className="flex items-center gap-2">
            {!hideActions ? actions : null}
            <div
              className="flex min-h-10 items-center gap-2 rounded-lg bg-[var(--surface-muted)] px-2.5 py-1.5"
              title={auth.username ?? undefined}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--text-primary)] text-[11px] font-semibold text-[var(--surface)]">
                {(auth.username ?? "U").slice(0, 1).toUpperCase()}
              </span>
              <div className="hidden min-w-0 sm:block">
                <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">{auth.username ?? "User"}</div>
                <div className="text-[11px] capitalize text-[var(--text-faint)]">
                  {auth.role?.replace("_", " ") ?? "—"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
