import React from "react";

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={["rounded-2xl border border-black/10 bg-white p-5 shadow-soft", className || ""].join(" ")}>
      {children}
    </div>
  );
}

