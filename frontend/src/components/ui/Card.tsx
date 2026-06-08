import React from "react";

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={[
        "rounded-xl bg-[var(--surface)] p-4 shadow-soft sm:p-5",
        className || ""
      ].join(" ")}
    >
      {children}
    </div>
  );
}

