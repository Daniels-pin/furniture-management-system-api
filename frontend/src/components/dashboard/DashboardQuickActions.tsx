import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { IconFileText, IconPlus, IconReceipt, IconUsers } from "./icons";

type QuickAction = {
  key: string;
  label: string;
  to: string;
  icon: ReactNode;
  roles?: string[];
};

const ALL_ACTIONS: QuickAction[] = [
  {
    key: "order",
    label: "New order",
    to: "/orders",
    icon: <IconPlus size={16} />,
    roles: ["admin", "showroom", "factory", "finance"]
  },
  {
    key: "customer",
    label: "New customer",
    to: "/customers",
    icon: <IconUsers size={16} />,
    roles: ["admin", "showroom", "finance"]
  },
  {
    key: "quotation",
    label: "Quotation",
    to: "/quotations/new",
    icon: <IconFileText size={16} />,
    roles: ["admin", "showroom", "finance"]
  },
  {
    key: "invoice",
    label: "Invoice",
    to: "/invoices",
    icon: <IconReceipt size={16} />,
    roles: ["admin", "showroom", "finance"]
  }
];

export function DashboardQuickActions({ role }: { role: string | null }) {
  const visible = ALL_ACTIONS.filter((a) => !a.roles || (role != null && a.roles.includes(role)));

  if (visible.length === 0) return null;

  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="Quick actions">
      {visible.map((a) => (
        <Link
          key={a.key}
          to={a.to}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--surface)] px-3.5 py-2 text-[13px] font-medium text-[var(--text-primary)] shadow-soft transition hover:bg-[var(--surface-muted)]"
        >
          <span className="text-[var(--text-muted)]" aria-hidden>
            {a.icon}
          </span>
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
