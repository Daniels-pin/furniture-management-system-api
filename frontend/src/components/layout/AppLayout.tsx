import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../state/auth";
import { useEffect, useRef, useState } from "react";
import { getErrorMessage } from "../../services/api";
import { useToast } from "../../state/toast";
import { contractJobsApi, customersApi, employeePaymentsApi, inventoryApi, notificationsApi, ordersApi } from "../../services/endpoints";
import { StatusBadge } from "../ui/StatusBadge";
import { APP_NAME } from "../../config/app";
import { env } from "../../env";
import { usePageHeaderState } from "./pageHeader";
import type { NotificationItem } from "../../types/api";

function NavItem({
  to,
  label,
  onNavigate,
  variant = "sidebar",
  badgeCount
}: {
  to: string;
  label: string;
  onNavigate?: () => void;
  variant?: "sidebar" | "drawer";
  badgeCount?: number;
}) {
  const sizing =
    variant === "drawer"
      ? "px-3 py-3.5 text-base"
      : "px-3 py-2 text-sm md:px-2.5 md:py-2 md:text-xs lg:px-3 lg:py-2.5 lg:text-sm";
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          "flex items-center justify-between gap-2 rounded-xl font-semibold transition",
          sizing,
          isActive ? "bg-black text-white" : "text-black/70 hover:bg-black/5 hover:text-black"
        ].join(" ")
      }
    >
      <span className="min-w-0 truncate">{label}</span>
      {typeof badgeCount === "number" ? (
        <span
          className={[
            "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold",
            badgeCount > 0 ? "bg-blue-600 text-white" : "bg-black/10 text-black/70"
          ].join(" ")}
          aria-label={`${label} count: ${badgeCount}`}
        >
          {badgeCount}
        </span>
      ) : null}
    </NavLink>
  );
}

type AppRole = ReturnType<typeof useAuth>["role"];
type NavGroupKey = "core" | "operations" | "production" | "workforce" | "financials" | "system";
type NavItemModel = {
  key: string;
  label: string;
  to: string | ((role: AppRole) => string);
  roles?: AppRole[];
  badge?: "pendingNegotiations";
};
type NavGroupModel = { key: NavGroupKey; label: string; items: NavItemModel[] };

const NAV_GROUPS: NavGroupModel[] = [
  {
    key: "core",
    label: "Core",
    items: [
      {
        key: "dashboard",
        label: "Dashboard",
        to: (role) => (role === "finance" ? "/finance" : role === "contract_employee" ? "/contract" : "/dashboard")
      }
    ]
  },
  {
    key: "operations",
    label: "Operations",
    items: [
      { key: "orders", label: "Orders", to: "/orders", roles: ["admin", "showroom", "factory", "finance"] },
      { key: "quotation", label: "Quotation", to: "/quotations", roles: ["admin", "showroom", "finance"] },
      { key: "proforma", label: "Proforma Invoice", to: "/proforma", roles: ["admin", "showroom", "finance"] },
      { key: "invoices", label: "Invoices", to: "/invoices", roles: ["admin", "showroom", "finance"] },
      { key: "waybill", label: "Waybill", to: "/waybills", roles: ["admin", "showroom", "finance"] },
      { key: "customers", label: "Customers", to: "/customers", roles: ["admin", "showroom", "finance"] }
    ]
  },
  {
    key: "production",
    label: "Production",
    items: [
      { key: "inventory", label: "Inventory", to: "/inventory", roles: ["admin", "factory"] },
      { key: "equipment", label: "Equipment", to: "/equipment", roles: ["admin", "factory"] }
    ]
  },
  {
    key: "workforce",
    label: "Workforce",
    items: [
      { key: "employees", label: "Employees", to: "/employees", roles: ["admin", "finance", "factory"] },
      { key: "company-locations", label: "Company Locations", to: "/admin/locations", roles: ["admin"] },
      { key: "jobs", label: "Jobs", to: "/admin/jobs", roles: ["admin"], badge: "pendingNegotiations" },
      { key: "employee-details", label: "Employee Details", to: "/employee-details" }
    ]
  },
  {
    key: "financials",
    label: "Financials",
    items: [
      { key: "finance", label: "Finance", to: "/finance", roles: ["admin", "finance"] },
      { key: "petty-cash", label: "Petty Cash", to: "/expenses", roles: ["admin", "finance"] }
    ]
  },
  {
    key: "system",
    label: "System",
    items: [
      { key: "account", label: "Account", to: "/account" },
      { key: "admin-users", label: "Admin Users", to: "/admin/users", roles: ["admin"] },
      { key: "activity-log", label: "Activity Log", to: "/admin/activity", roles: ["admin"] },
      { key: "trash", label: "Trash", to: "/trash", roles: ["admin", "showroom", "factory"] }
    ]
  }
];

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="my-2.5 border-t border-black/10 pt-2.5">
      <div className="px-2 text-[10px] font-extrabold uppercase tracking-wider text-black/45">{label}</div>
    </div>
  );
}

function AppNavLinks({
  onNavigate,
  variant,
  pendingNegotiationsCount
}: {
  onNavigate?: () => void;
  variant: "sidebar" | "drawer";
  pendingNegotiationsCount: number;
}) {
  const auth = useAuth();
  const role = auth.role;

  function isVisible(item: NavItemModel) {
    if (!item.roles) return true;
    return item.roles.includes(role);
  }

  function resolveTo(item: NavItemModel) {
    return typeof item.to === "function" ? item.to(role) : item.to;
  }

  function resolveBadge(item: NavItemModel) {
    if (item.badge === "pendingNegotiations") return pendingNegotiationsCount;
    return undefined;
  }

  return (
    <nav className="space-y-1">
      {NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter(isVisible);
        if (visibleItems.length === 0) return null;
        return (
          <div key={group.key}>
            <SectionDivider label={group.label} />
            {visibleItems.map((item) => (
              <NavItem
                key={item.key}
                variant={variant}
                onNavigate={onNavigate}
                to={resolveTo(item)}
                label={item.label}
                badgeCount={resolveBadge(item)}
              />
            ))}
          </div>
        );
      })}
    </nav>
  );
}

export function AppLayout() {
  const auth = useAuth();
  const toast = useToast();
  const location = useLocation();
  const nav = useNavigate();
  const pageHeader = usePageHeaderState();
  const hideTopRightActions = auth.role === "contract_employee" && location.pathname === "/contract";
  const [exitImpLoading, setExitImpLoading] = useState(false);
  const [dueSoon, setDueSoon] = useState<number>(0);
  const [open, setOpen] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alerts, setAlerts] = useState<Awaited<ReturnType<typeof ordersApi.alerts>> | null>(null);
  const [bOpen, setBOpen] = useState(false);
  const [birthdaysLoading, setBirthdaysLoading] = useState(false);
  const [birthdays, setBirthdays] = useState<Awaited<ReturnType<typeof customersApi.birthdaysToday>> | null>(null);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [pendingMoneyCount, setPendingMoneyCount] = useState(0);
  const [assignedJobsCount, setAssignedJobsCount] = useState(0);
  const [pendingNegotiationsCount, setPendingNegotiationsCount] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const lastNotifIdRef = useRef<number>(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const bWrapRef = useRef<HTMLDivElement | null>(null);
  const notifWrapRef = useRef<HTMLDivElement | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifPage, setNotifPage] = useState<Awaited<ReturnType<typeof notificationsApi.my>> | null>(null);

  useEffect(() => {
    // Reset per-user on login/logout.
    const key = auth.userId ? `furniture_last_notif_created_at_${auth.userId}` : null;
    const saved = key ? String(localStorage.getItem(key) || "") : "";
    // We store an ISO timestamp string; empty means "no baseline".
    lastNotifIdRef.current = 0; // kept for backward compatibility (unused by new polling)
    if (key && !saved) localStorage.setItem(key, "");
  }, [auth.userId, auth.token]);

  useEffect(() => {
    if (!auth.token || !auth.userId) return;
    let alive = true;
    const key = `furniture_last_notif_created_at_${auth.userId}`;

    async function tick() {
      try {
        const lastCreatedAt = localStorage.getItem(key) || "";
        const baseline = lastCreatedAt ? new Date(lastCreatedAt).getTime() : 0;
        const res = await notificationsApi.my({ unread_only: true, limit: 200 });
        if (!alive) return;
        const items = Array.isArray(res?.items) ? [...res.items] : [];
        // Toast any unread notification whose (possibly bumped) created_at is newer than our baseline.
        items.sort((a: NotificationItem, b: NotificationItem) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        let newest = baseline;
        for (const n of items) {
          const t = new Date(n.created_at).getTime();
          if (!Number.isFinite(t)) continue;
          newest = Math.max(newest, t);
          if (t <= baseline) continue;
          toast.push("success", n.title + (n.message ? ` — ${n.message}` : ""));
        }
        if (newest > baseline) localStorage.setItem(key, new Date(newest).toISOString());
      } catch {
        // ignore (non-critical)
      }
    }

    void tick();
    const iv = window.setInterval(() => void tick(), 10_000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, [auth.token, auth.userId, toast]);

  useEffect(() => {
    if (!auth.token || !auth.userId || auth.role !== "contract_employee") {
      setAssignedJobsCount(0);
      return;
    }
    let alive = true;
    async function refreshAssignedBadge() {
      try {
        const res = await notificationsApi.my({ unread_only: true, limit: 200 });
        if (!alive) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        const count = items.filter((n: any) => n?.kind === "job_assigned").length;
        setAssignedJobsCount(count);
      } catch {
        if (!alive) return;
        setAssignedJobsCount(0);
      }
    }

    const onUpdated = () => void refreshAssignedBadge();
    window.addEventListener("furniture:notifications-updated", onUpdated as any);
    void refreshAssignedBadge();
    const iv = window.setInterval(() => void refreshAssignedBadge(), 15_000);
    return () => {
      alive = false;
      window.removeEventListener("furniture:notifications-updated", onUpdated as any);
      window.clearInterval(iv);
    };
  }, [auth.token, auth.userId, auth.role, location.pathname]);

  useEffect(() => {
    if (auth.role !== "admin") {
      setPendingNegotiationsCount(0);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await contractJobsApi.pendingNegotiationsCount();
        if (!alive) return;
        setPendingNegotiationsCount(typeof res?.count === "number" ? res.count : 0);
      } catch {
        if (!alive) return;
        setPendingNegotiationsCount(0);
      }
    })();
    return () => {
      alive = false;
    };
  }, [auth.role, location.pathname]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  useEffect(() => {
    if (auth.role === "finance") {
      setDueSoon(0);
      setAlerts(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await ordersApi.alerts();
        if (!alive) return;
        setDueSoon(typeof res?.due_soon_count === "number" ? res.due_soon_count : 0);
      } catch {
        // ignore (badge is non-critical)
      }
    })();
    return () => {
      alive = false;
    };
  }, [location.pathname, auth.role]);

  useEffect(() => {
    if (auth.role !== "admin" && auth.role !== "finance") {
      setPendingMoneyCount(0);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await employeePaymentsApi.pending({ kind: "contract", sort: "oldest", limit: 1, offset: 0 });
        if (!alive) return;
        setPendingMoneyCount(typeof res?.total === "number" ? res.total : Array.isArray(res?.items) ? res.items.length : 0);
      } catch {
        if (!alive) return;
        setPendingMoneyCount(0);
      }
    })();
    return () => {
      alive = false;
    };
  }, [location.pathname, auth.role]);

  useEffect(() => {
    if (auth.role === "factory" || auth.role === "finance") {
      setBirthdays(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await customersApi.birthdaysToday();
        if (!alive) return;
        setBirthdays(res);
      } catch {
        // ignore (badge is non-critical)
      }
    })();
    return () => {
      alive = false;
    };
  }, [location.pathname, auth.role]);

  useEffect(() => {
    if (auth.role !== "admin" && auth.role !== "factory") {
      setLowStockCount(0);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await inventoryApi.lowStockCount();
        if (!alive) return;
        setLowStockCount(typeof res?.count === "number" ? res.count : 0);
      } catch {
        if (!alive) return;
        setLowStockCount(0);
      }
    })();
    return () => {
      alive = false;
    };
  }, [location.pathname, auth.role]);

  const showRed = dueSoon > 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!notifOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = notifWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setNotifOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [notifOpen]);

  useEffect(() => {
    if (!bOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = bWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setBOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [bOpen]);

  async function toggleBell() {
    if (auth.role === "finance") return;
    const next = !open;
    setOpen(next);
    if (!next) return;
    setAlertsLoading(true);
    try {
      const res = await ordersApi.alerts();
      setAlerts(res);
      setDueSoon(typeof res?.due_soon_count === "number" ? res.due_soon_count : 0);
    } finally {
      setAlertsLoading(false);
    }
  }

  async function toggleNotifications() {
    const next = !notifOpen;
    setNotifOpen(next);
    if (!next) return;
    if (!auth.token || !auth.userId) return;
    setNotifLoading(true);
    try {
      const res = await notificationsApi.my({ limit: 30 });
      setNotifPage(res);
    } finally {
      setNotifLoading(false);
    }
  }

  async function toggleBirthdays() {
    if (auth.role === "finance") return;
    const next = !bOpen;
    setBOpen(next);
    if (!next) return;
    setBirthdaysLoading(true);
    try {
      const res = await customersApi.birthdaysToday();
      setBirthdays(res);
    } finally {
      setBirthdaysLoading(false);
    }
  }

  const closeDrawer = () => setDrawerOpen(false);

  const title = pageHeader?.title ?? APP_NAME;
  const subtitle = pageHeader?.subtitle ?? null;

  return (
    <div className="min-h-dvh overflow-x-hidden bg-white">
      {auth.isImpersonation ? (
        <div
          className="border-b border-amber-700/20 bg-amber-100 px-4 py-2.5 text-center text-sm font-semibold text-amber-950"
          role="status"
        >
          <span>
            You are logged in as{" "}
            <span className="font-bold">{auth.impersonationSubject ?? auth.username ?? "user"}</span>{" "}
            (Impersonation Mode)
          </span>
          <button
            type="button"
            disabled={exitImpLoading}
            className="ml-3 inline-flex min-h-10 items-center rounded-lg border border-amber-800/40 bg-white px-3 py-2 text-xs font-bold text-amber-950 shadow-sm hover:bg-amber-50 disabled:opacity-60"
            onClick={() => {
              setExitImpLoading(true);
              void auth
                .exitImpersonation()
                .then(() => nav("/dashboard", { replace: true }))
                .catch((e) => toast.push("error", getErrorMessage(e)))
                .finally(() => setExitImpLoading(false));
            }}
          >
            {exitImpLoading ? "Exiting…" : "Exit"}
          </button>
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-7xl min-w-0 px-4 py-4 md:py-6">
        <header className="sticky top-0 z-30 -mx-4 mb-4 flex min-h-[3.25rem] items-center gap-2 border-b border-black/10 bg-white/95 px-4 py-2.5 backdrop-blur-md supports-[backdrop-filter]:bg-white/85 md:hidden">
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-white text-black shadow-soft hover:bg-black/[0.02]"
            aria-label={drawerOpen ? "Close menu" : "Open menu"}
            aria-expanded={drawerOpen}
            aria-controls="app-mobile-nav"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <span className="flex w-5 flex-col gap-1.5" aria-hidden>
              <span className="h-0.5 w-full rounded-full bg-black" />
              <span className="h-0.5 w-full rounded-full bg-black" />
              <span className="h-0.5 w-full rounded-full bg-black" />
            </span>
          </button>
          <NavLink
            to={auth.role === "finance" ? "/finance" : "/dashboard"}
            onClick={closeDrawer}
            className="min-w-0 flex-1 truncate text-center text-sm font-bold tracking-tight text-black hover:opacity-80"
          >
            {title}
          </NavLink>
          <div className="w-11 shrink-0" aria-hidden />
        </header>

        <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-[minmax(0,220px)_1fr] lg:grid-cols-[240px_1fr]">
          <aside className="hidden min-w-0 overflow-hidden rounded-2xl border border-black/10 bg-white p-3 shadow-soft md:block md:rounded-2xl lg:rounded-3xl lg:p-4">
            <div className="px-2 pb-3 lg:pb-4">
              <div className="min-w-0">
                <NavLink
                  to={auth.role === "finance" ? "/finance" : "/dashboard"}
                  className="block w-full min-w-0 break-words text-sm font-bold leading-snug tracking-tight text-black hover:opacity-80 lg:text-base"
                >
                  {APP_NAME}
                </NavLink>
              </div>
            </div>

            <AppNavLinks variant="sidebar" pendingNegotiationsCount={pendingNegotiationsCount} />

            <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.02] p-3 lg:mt-6">
              <div className="text-xs font-semibold lg:text-sm">
                {auth.role === "admin"
                  ? "Admin"
                  : auth.role === "finance"
                    ? "Finance"
                    : auth.role === "factory"
                      ? "Factory"
                      : auth.role === "contract_employee"
                        ? "Contract"
                        : "Showroom"}
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-black/60 lg:text-xs">
                Role:{" "}
                {auth.role === "admin"
                  ? "Admin"
                  : auth.role === "finance"
                    ? "Finance"
                    : auth.role === "factory"
                      ? "Factory"
                      : auth.role === "contract_employee"
                        ? "Contract"
                        : "Showroom"}
              </div>
              <button
                className="mt-3 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold hover:bg-black/5"
                onClick={() => auth.logout()}
              >
                Log out
              </button>
            </div>
          </aside>

          <main className="min-w-0">
            <div
              className={[
                "mb-4 flex flex-col gap-3 border-b border-black/10 pb-4 md:flex-row md:items-center",
                hideTopRightActions ? "md:justify-start" : "md:justify-between"
              ].join(" ")}
            >
              <div className="flex min-w-0 items-start gap-3">
                <img
                  src={env.logoUrl || "/logo.png"}
                  alt={`${APP_NAME} logo`}
                  className="h-auto max-h-20 w-auto max-w-full shrink-0 object-contain sm:max-h-[84px] md:max-h-[92px]"
                  draggable={false}
                  loading="eager"
                />
                <div className="min-w-0">
                  <div className="text-2xl font-bold tracking-tight">{title}</div>
                  {subtitle ? <div className="mt-1 text-sm text-black/60">{subtitle}</div> : null}
                  {auth.username && title === "Dashboard" ? (
                    <div className="mt-1 text-sm font-semibold text-black/70">Signed in as {auth.username}</div>
                  ) : null}
                </div>
              </div>
              {!hideTopRightActions ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="relative" ref={notifWrapRef}>
                    {!auth.token ? null : (
                      <button
                        type="button"
                        className="relative flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-black/10 bg-white px-3 py-2 shadow-soft hover:bg-black/[0.02]"
                        aria-label={`Notifications${notifPage?.unread_count ? `: ${notifPage.unread_count}` : ""}`}
                        onClick={() => void toggleNotifications()}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path
                            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Z"
                            stroke="currentColor"
                            strokeWidth="1.6"
                          />
                          <path
                            d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span
                          className={[
                            "absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold",
                            (notifPage?.unread_count ?? 0) > 0 ? "bg-indigo-600 text-white" : "bg-black/10 text-black/70"
                          ].join(" ")}
                        >
                          {notifPage?.unread_count ?? 0}
                        </span>
                      </button>
                    )}

                    {notifOpen ? (
                      <div className="absolute right-0 z-20 mt-2 w-[min(420px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl border border-black/10 bg-white shadow-soft">
                        <div className="flex items-center justify-between gap-2 px-4 py-3">
                          <div className="text-sm font-semibold">Notifications</div>
                          <button
                            type="button"
                            className="min-h-10 min-w-10 rounded-xl px-2 py-2 text-sm font-semibold text-black/70 hover:bg-black/5"
                            onClick={() => setNotifOpen(false)}
                          >
                            Close
                          </button>
                        </div>
                        <div className="border-t border-black/10">
                          {notifLoading ? (
                            <div className="px-4 py-4 text-sm text-black/60">Loading…</div>
                          ) : !notifPage || !Array.isArray(notifPage.items) || notifPage.items.length === 0 ? (
                            <div className="px-4 py-4 text-sm text-black/60">No notifications</div>
                          ) : (
                            <div className="max-h-[min(380px,70dvh)] overflow-y-auto overscroll-contain">
                              <div className="divide-y divide-black/5">
                                {notifPage.items.map((n) => (
                                  <button
                                    key={n.id}
                                    type="button"
                                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-black/[0.02]"
                                    onClick={() => {
                                      void notificationsApi
                                        .markRead(n.id)
                                        .then(() => notificationsApi.my({ limit: 30 }))
                                        .then((res) => setNotifPage(res))
                                        .then(() => window.dispatchEvent(new Event("furniture:notifications-updated")))
                                        .catch(() => null);
                                    }}
                                  >
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold">{n.title}</div>
                                      {n.message ? <div className="mt-0.5 text-xs text-black/60">{n.message}</div> : null}
                                      <div className="mt-1 text-[11px] font-semibold text-black/45">
                                        {new Date(n.created_at).toLocaleString()}
                                      </div>
                                    </div>
                                    <div className="shrink-0 text-[11px] font-bold text-black/50">{n.read_at ? "Read" : "New"}</div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-2 border-t border-black/10 px-4 py-3">
                            <button
                              type="button"
                              className="min-h-10 rounded-xl px-3 text-xs font-bold text-black/70 hover:bg-black/5"
                              onClick={() => {
                                void notificationsApi
                                  .markAllRead()
                                  .then(() => notificationsApi.my({ limit: 30 }))
                                  .then((res) => setNotifPage(res))
                                  .then(() => window.dispatchEvent(new Event("furniture:notifications-updated")))
                                  .catch(() => null);
                              }}
                            >
                              Mark all read
                            </button>
                            <div className="text-xs font-semibold text-black/50">Unread: {notifPage?.unread_count ?? 0}</div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {auth.role === "contract_employee" ? (
                    <button
                      type="button"
                      className="relative flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-black/10 bg-white px-3 py-2 shadow-soft hover:bg-black/[0.02]"
                      aria-label={`Assigned jobs${assignedJobsCount ? `: ${assignedJobsCount}` : ""}`}
                      onClick={() => {
                        nav("/contract?tab=jobs");
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                        <path d="M4 8h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                        <path d="M4 8V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.6" />
                      </svg>
                      <span
                        className={[
                          "absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold",
                          assignedJobsCount > 0 ? "bg-blue-600 text-white" : "bg-black/10 text-black/70"
                        ].join(" ")}
                      >
                        {assignedJobsCount}
                      </span>
                    </button>
                  ) : null}

                  {auth.role === "admin" || auth.role === "finance" ? (
                    <button
                      type="button"
                      className="relative flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-black/10 bg-white px-3 py-2 shadow-soft hover:bg-black/[0.02]"
                      aria-label={`Pending payment requests${pendingMoneyCount ? `: ${pendingMoneyCount}` : ""}`}
                      onClick={() => {
                        if (auth.role === "finance") nav("/finance");
                        else nav("/employees?tab=contract");
                      }}
                    >
                      <span className="text-base" aria-hidden>
                        💰
                      </span>
                      <span
                        className={[
                          "absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold",
                          pendingMoneyCount > 0 ? "bg-emerald-600 text-white" : "bg-black/10 text-black/70"
                        ].join(" ")}
                      >
                        {pendingMoneyCount}
                      </span>
                    </button>
                  ) : null}

                  <div className="relative" ref={bWrapRef}>
                    {auth.role === "factory" || auth.role === "finance" ? null : (
                      <>
                        <button
                          className="relative flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-black/10 bg-white px-3 py-2 shadow-soft hover:bg-black/[0.02]"
                          aria-label="Birthdays today"
                          type="button"
                          onClick={() => void toggleBirthdays()}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M12 2c1.1 0 2 .9 2 2v2h-4V4c0-1.1.9-2 2-2Z" stroke="currentColor" strokeWidth="1.6" />
                            <path d="M6 10h12v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                            <path d="M5 10h14" stroke="currentColor" strokeWidth="1.6" />
                          </svg>
                          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-black/10 px-1.5 py-0.5 text-[11px] font-bold text-black/70">
                            {Array.isArray(birthdays) ? birthdays.length : 0}
                          </span>
                        </button>

                        {bOpen ? (
                          <div className="absolute right-0 z-20 mt-2 w-[min(420px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl border border-black/10 bg-white shadow-soft">
                            <div className="flex items-center justify-between px-4 py-3">
                              <div className="text-sm font-semibold">Birthdays today</div>
                              <button
                                type="button"
                                className="min-h-10 min-w-10 rounded-xl px-2 py-2 text-sm font-semibold text-black/70 hover:bg-black/5"
                                onClick={() => setBOpen(false)}
                              >
                                Close
                              </button>
                            </div>
                            <div className="max-h-[min(360px,70dvh)] overflow-y-auto overscroll-contain border-t border-black/10">
                              {birthdaysLoading ? (
                                <div className="px-4 py-4 text-sm text-black/60">Loading…</div>
                              ) : !birthdays || birthdays.length === 0 ? (
                                <div className="px-4 py-4 text-sm text-black/60">No birthdays today</div>
                              ) : (
                                <div className="divide-y divide-black/5">
                                  {birthdays.map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      className="flex min-h-12 w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-black/[0.02]"
                                      onClick={() => {
                                        setBOpen(false);
                                        nav("/customers");
                                      }}
                                    >
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold">{c.name}</div>
                                        <div className="mt-0.5 text-xs text-black/60">
                                          {c.birth_day && c.birth_month ? `${c.birth_day}/${c.birth_month}` : "—"}
                                        </div>
                                      </div>
                                      <div className="shrink-0 text-xs font-semibold text-black/50">View</div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>

                  {auth.role === "admin" || auth.role === "factory" ? (
                    <button
                      type="button"
                      className="relative flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-black/10 bg-white px-3 py-2 shadow-soft hover:bg-black/[0.02]"
                      aria-label={`Low stock materials${lowStockCount ? `: ${lowStockCount}` : ""}`}
                      onClick={() => nav("/inventory")}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M4 8h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                        <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M4 12h16" stroke="currentColor" strokeWidth="1.6" />
                      </svg>
                      <span
                        className={[
                          "absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold",
                          lowStockCount > 0 ? "bg-amber-500 text-white" : "bg-black/10 text-black/70"
                        ].join(" ")}
                      >
                        {lowStockCount}
                      </span>
                    </button>
                  ) : null}

                  <div className="relative" ref={wrapRef}>
                    {auth.role === "finance" ? null : (
                      <button
                        className="relative flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-black/10 bg-white px-3 py-2 shadow-soft hover:bg-black/[0.02]"
                        aria-label="Due soon alerts"
                        type="button"
                        onClick={() => void toggleBell()}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Z" stroke="currentColor" strokeWidth="1.6" />
                          <path
                            d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span
                          className={[
                            "absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold",
                            showRed ? "bg-red-600 text-white" : "bg-black/10 text-black/70"
                          ].join(" ")}
                        >
                          {dueSoon}
                        </span>
                      </button>
                    )}

                    {open ? (
                      <div className="absolute right-0 z-20 mt-2 w-[min(420px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl border border-black/10 bg-white shadow-soft">
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="text-sm font-semibold">Due soon</div>
                          <button
                            type="button"
                            className="min-h-10 min-w-10 rounded-xl px-2 py-2 text-sm font-semibold text-black/70 hover:bg-black/5"
                            onClick={() => setOpen(false)}
                          >
                            Close
                          </button>
                        </div>
                        <div className="max-h-[min(360px,70dvh)] overflow-y-auto overscroll-contain border-t border-black/10">
                          {alertsLoading ? (
                            <div className="px-4 py-4 text-sm text-black/60">Loading…</div>
                          ) : !alerts || alerts.orders.length === 0 ? (
                            <div className="px-4 py-4 text-sm text-black/60">No upcoming due orders</div>
                          ) : (
                            <div className="divide-y divide-black/5">
                              {alerts.orders.map((o) => (
                                <button
                                  key={o.order_id}
                                  type="button"
                                  className="flex min-h-12 w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-black/[0.02]"
                                  onClick={() => {
                                    setOpen(false);
                                    nav(`/orders/${o.order_id}`);
                                  }}
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold">Order #{o.order_id}</div>
                                    <div className="mt-0.5 text-xs text-black/60">
                                      Due: {o.due_date ? new Date(o.due_date).toLocaleDateString() : "—"}
                                      {o.customer?.name ? ` • ${o.customer.name}` : ""}
                                    </div>
                                  </div>
                                  <div className="shrink-0">
                                    <StatusBadge status={o.status} />
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            <Outlet />
          </main>
        </div>
      </div>

      {drawerOpen ? (
        <div
          className="fixed inset-0 z-50 flex md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Main navigation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close menu"
            onClick={closeDrawer}
          />
          <div
            id="app-mobile-nav"
            className="relative flex h-full w-[min(19rem,88vw)] max-w-full min-w-0 flex-col border-r border-black/10 bg-white shadow-xl"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/10 px-4 py-3">
              <div className="min-w-0 text-sm font-bold tracking-tight text-black">{APP_NAME}</div>
              <button
                type="button"
                className="flex min-h-10 min-w-10 items-center justify-center rounded-xl text-sm font-semibold text-black/70 hover:bg-black/5"
                aria-label="Close menu"
                onClick={closeDrawer}
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
              <AppNavLinks
                variant="drawer"
                onNavigate={closeDrawer}
                pendingNegotiationsCount={pendingNegotiationsCount}
              />
            </div>
            <div className="shrink-0 border-t border-black/10 bg-black/[0.02] p-4">
              <div className="text-xs font-semibold">
                {auth.role === "admin"
                  ? "Admin"
                  : auth.role === "finance"
                    ? "Finance"
                    : auth.role === "factory"
                      ? "Factory"
                      : auth.role === "contract_employee"
                        ? "Contract"
                        : "Showroom"}
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-black/60">
                Role:{" "}
                {auth.role === "admin"
                  ? "Admin"
                  : auth.role === "finance"
                    ? "Finance"
                    : auth.role === "factory"
                      ? "Factory"
                      : auth.role === "contract_employee"
                        ? "Contract"
                        : "Showroom"}
              </div>
              <button
                type="button"
                className="mt-3 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold hover:bg-black/5"
                onClick={() => auth.logout()}
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
