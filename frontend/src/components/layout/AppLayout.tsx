import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../state/auth";
import { useEffect, useRef, useState } from "react";
import { customersApi, ordersApi } from "../../services/endpoints";
import { StatusBadge } from "../ui/StatusBadge";
import { APP_NAME } from "../../config/app";

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "block rounded-xl px-3 py-2 text-sm font-semibold transition",
          isActive ? "bg-black text-white" : "text-black/70 hover:bg-black/5 hover:text-black"
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}

export function AppLayout() {
  const auth = useAuth();
  const location = useLocation();
  const nav = useNavigate();
  const [dueSoon, setDueSoon] = useState<number>(0);
  const [open, setOpen] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alerts, setAlerts] = useState<Awaited<ReturnType<typeof ordersApi.alerts>> | null>(null);
  const [bOpen, setBOpen] = useState(false);
  const [birthdaysLoading, setBirthdaysLoading] = useState(false);
  const [birthdays, setBirthdays] = useState<Awaited<ReturnType<typeof customersApi.birthdaysToday>> | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const bWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
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
  }, [location.pathname]);

  useEffect(() => {
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
  }, [location.pathname]);

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

  async function toggleBirthdays() {
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

  return (
    <div className="min-h-dvh bg-white">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[240px_1fr]">
        <aside className="rounded-3xl border border-black/10 bg-white p-4 shadow-soft">
          <div className="px-2 pb-4">
            <div className="text-lg font-bold tracking-tight">{APP_NAME}</div>
          </div>

          <nav className="space-y-1">
            <NavItem to="/dashboard" label="Dashboard" />
            <NavItem to="/orders" label="Orders" />
            {auth.role === "admin" || auth.role === "showroom" ? (
              <NavItem to="/invoices" label="Invoices" />
            ) : null}
            <NavItem to="/customers" label="Customers" />
            {auth.role === "admin" ? <NavItem to="/admin/users" label="Admin Users" /> : null}
          </nav>

          <div className="mt-6 rounded-2xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-sm font-semibold">
              {auth.role === "admin" ? "Admin" : auth.role === "factory" ? "Factory" : "Showroom"}
            </div>
            <div className="mt-0.5 text-xs font-semibold text-black/60">
              Role: {auth.role === "admin" ? "Admin" : auth.role === "factory" ? "Factory" : "Showroom"}
            </div>
            <button
              className="mt-3 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
              onClick={() => auth.logout()}
            >
              Log out
            </button>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="mb-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <div className="relative" ref={bWrapRef}>
                <button
                  className="relative rounded-2xl border border-black/10 bg-white px-3 py-2 shadow-soft hover:bg-black/[0.02]"
                  aria-label="Birthdays today"
                  type="button"
                  onClick={() => void toggleBirthdays()}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 2c1.1 0 2 .9 2 2v2h-4V4c0-1.1.9-2 2-2Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <path
                      d="M6 10h12v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                    <path d="M5 10h14" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                  <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-black/10 px-1.5 py-0.5 text-[11px] font-bold text-black/70">
                    {Array.isArray(birthdays) ? birthdays.length : 0}
                  </span>
                </button>

                {bOpen ? (
                  <div className="absolute right-0 mt-2 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-black/10 bg-white shadow-soft">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="text-sm font-semibold">Birthdays today</div>
                      <button
                        className="rounded-xl px-2 py-1 text-sm font-semibold text-black/70 hover:bg-black/5"
                        onClick={() => setBOpen(false)}
                      >
                        Close
                      </button>
                    </div>
                    <div className="max-h-[360px] overflow-auto border-t border-black/10">
                      {birthdaysLoading ? (
                        <div className="px-4 py-4 text-sm text-black/60">Loading…</div>
                      ) : !birthdays || birthdays.length === 0 ? (
                        <div className="px-4 py-4 text-sm text-black/60">No birthdays today</div>
                      ) : (
                        <div className="divide-y divide-black/5">
                          {birthdays.map((c) => (
                            <button
                              key={c.id}
                              className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-black/[0.02]"
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
              </div>

              <div className="relative" ref={wrapRef}>
              <button
                className="relative rounded-2xl border border-black/10 bg-white px-3 py-2 shadow-soft hover:bg-black/[0.02]"
                aria-label="Due soon alerts"
                type="button"
                onClick={() => void toggleBell()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
                    showRed ? "bg-red-600 text-white" : "bg-black/10 text-black/70"
                  ].join(" ")}
                >
                  {dueSoon}
                </span>
              </button>

              {open ? (
                <div className="absolute right-0 mt-2 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-black/10 bg-white shadow-soft">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="text-sm font-semibold">Due soon</div>
                    <button
                      className="rounded-xl px-2 py-1 text-sm font-semibold text-black/70 hover:bg-black/5"
                      onClick={() => setOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                  <div className="max-h-[360px] overflow-auto border-t border-black/10">
                    {alertsLoading ? (
                      <div className="px-4 py-4 text-sm text-black/60">Loading…</div>
                    ) : !alerts || alerts.orders.length === 0 ? (
                      <div className="px-4 py-4 text-sm text-black/60">No upcoming due orders</div>
                    ) : (
                      <div className="divide-y divide-black/5">
                        {alerts.orders.map((o) => (
                          <button
                            key={o.order_id}
                            className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-black/[0.02]"
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
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

