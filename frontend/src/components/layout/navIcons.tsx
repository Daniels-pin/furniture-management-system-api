import type { ReactNode } from "react";

function NavSvg({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden>
      {children}
    </svg>
  );
}

const NAV_ICON_MAP: Record<string, ReactNode> = {
  dashboard: (
    <NavSvg>
      <path d="M4 11 12 4l8 7v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </NavSvg>
  ),
  orders: (
    <NavSvg>
      <path d="M6 6h15l-1.5 9H7.5L6 6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="9" cy="20" r="1.5" fill="currentColor" />
      <circle cx="18" cy="20" r="1.5" fill="currentColor" />
    </NavSvg>
  ),
  quotation: (
    <NavSvg>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </NavSvg>
  ),
  proforma: (
    <NavSvg>
      <path d="M8 6h12M8 12h12M8 18h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4 4v16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </NavSvg>
  ),
  invoices: (
    <NavSvg>
      <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21 8 19.5 6 21V3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </NavSvg>
  ),
  waybill: (
    <NavSvg>
      <path d="M3 7h11v10H3V7ZM14 10h7v7h-7v-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 10V6h9v4" stroke="currentColor" strokeWidth="1.6" />
    </NavSvg>
  ),
  customers: (
    <NavSvg>
      <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </NavSvg>
  ),
  inventory: (
    <NavSvg>
      <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </NavSvg>
  ),
  "production-materials": (
    <NavSvg>
      <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </NavSvg>
  ),
  equipment: (
    <NavSvg>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </NavSvg>
  ),
  employees: (
    <NavSvg>
      <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.6" />
    </NavSvg>
  ),
  "attendance-records": (
    <NavSvg>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 3v4M16 3v4M3 11h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </NavSvg>
  ),
  "company-locations": (
    <NavSvg>
      <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="10" r="2" stroke="currentColor" strokeWidth="1.6" />
    </NavSvg>
  ),
  jobs: (
    <NavSvg>
      <path d="M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 8h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" stroke="currentColor" strokeWidth="1.6" />
    </NavSvg>
  ),
  "employee-details": (
    <NavSvg>
      <path d="M4 19.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </NavSvg>
  ),
  finance: (
    <NavSvg>
      <path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </NavSvg>
  ),
  "petty-cash": (
    <NavSvg>
      <rect x="2" y="6" width="20" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.6" />
    </NavSvg>
  ),
  account: (
    <NavSvg>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 20c1.5-4 5-6 7-6s5.5 2 7 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </NavSvg>
  ),
  "staff-profile": (
    <NavSvg>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </NavSvg>
  ),
  "admin-users": (
    <NavSvg>
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 20v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </NavSvg>
  ),
  "activity-log": (
    <NavSvg>
      <path d="M4 14l4-4 3 3 5-7 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </NavSvg>
  ),
  trash: (
    <NavSvg>
      <path d="M4 7h16M9 7V5h6v2M7 7v12h10V7" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </NavSvg>
  )
};

export function NavIcon({ navKey }: { navKey: string }) {
  return NAV_ICON_MAP[navKey] ?? (
    <NavSvg>
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </NavSvg>
  );
}
