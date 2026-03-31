import React from "react";

export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-black/15 bg-white px-2.5 py-1 text-xs font-semibold text-black/80">
      {children}
    </span>
  );
}

