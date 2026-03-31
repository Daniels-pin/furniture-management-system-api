import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../state/auth";

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

  return (
    <div className="min-h-dvh bg-white">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[240px_1fr]">
        <aside className="rounded-3xl border border-black/10 bg-white p-4 shadow-soft">
          <div className="px-2 pb-4">
            <div className="text-sm font-semibold text-black/70">Furniture</div>
            <div className="text-lg font-bold tracking-tight">Management</div>
          </div>

          <nav className="space-y-1">
            <NavItem to="/dashboard" label="Dashboard" />
            <NavItem to="/orders" label="Orders" />
            <NavItem to="/customers" label="Customers" />
            <NavItem to="/products" label="Products" />
            {auth.role === "admin" ? <NavItem to="/admin/users" label="Admin Users" /> : null}
          </nav>

          <div className="mt-6 rounded-2xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-xs font-semibold text-black/60">Signed in</div>
            <div className="mt-0.5 text-sm font-semibold">{auth.role ?? "unknown role"}</div>
            <button
              className="mt-3 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-semibold hover:bg-black/5"
              onClick={() => auth.logout()}
            >
              Log out
            </button>
          </div>
        </aside>

        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

