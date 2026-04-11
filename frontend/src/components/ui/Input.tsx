import React from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export function Input({ label, hint, error, className, ...rest }: Props) {
  return (
    <label className="block">
      {label ? <div className="mb-1 text-sm font-medium">{label}</div> : null}
      <input
        className={[
          "min-h-11 w-full rounded-xl border bg-white px-3 py-2.5 text-base shadow-sm outline-none transition sm:text-sm",
          error ? "border-black/30" : "border-black/15",
          "focus:border-black/40",
          className || ""
        ].join(" ")}
        {...rest}
      />
      {error ? (
        <div className="mt-1 text-xs text-black/70">{error}</div>
      ) : hint ? (
        <div className="mt-1 text-xs text-black/50">{hint}</div>
      ) : null}
    </label>
  );
}

