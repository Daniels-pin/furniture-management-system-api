import React from "react";
import type { OrderStatus } from "../../types/api";

function labelFor(status: OrderStatus) {
  if (status === "in_progress") return "In progress";
  return status[0].toUpperCase() + status.slice(1);
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset";

  const cls =
    status === "pending"
      ? "bg-black/5 text-black/70 ring-black/10"
      : status === "in_progress"
        ? "bg-yellow-100 text-yellow-900 ring-yellow-200"
        : status === "completed"
          ? "bg-green-100 text-green-900 ring-green-200"
          : "bg-black/5 text-black/70 ring-black/10";

  return <span className={[base, cls].join(" ")}>{labelFor(status)}</span>;
}

