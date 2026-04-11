import React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  isLoading?: boolean;
};

export function Button({ variant = "primary", isLoading, className, disabled, ...rest }: Props) {
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60";
  const styles =
    variant === "primary"
      ? "bg-black text-white hover:bg-black/90"
      : variant === "secondary"
        ? "border border-black/15 bg-white text-black hover:bg-black/5"
        : variant === "danger"
          ? "bg-black text-white hover:bg-black/90"
          : "text-black hover:bg-black/5";

  return (
    <button
      className={[base, styles, className || ""].join(" ")}
      disabled={disabled || isLoading}
      {...rest}
    >
      {isLoading ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          Loading
        </span>
      ) : (
        rest.children
      )}
    </button>
  );
}

