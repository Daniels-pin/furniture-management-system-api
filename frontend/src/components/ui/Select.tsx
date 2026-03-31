import React from "react";

type Option = { value: string; label: string };

type Props = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  options: Option[];
  hint?: string;
  error?: string;
};

export function Select({ label, options, hint, error, className, ...rest }: Props) {
  return (
    <label className="block">
      {label ? <div className="mb-1 text-sm font-medium">{label}</div> : null}
      <select
        className={[
          "w-full rounded-xl border bg-white px-3 py-2 text-sm shadow-sm outline-none transition",
          error ? "border-black/30" : "border-black/15",
          "focus:border-black/40",
          className || ""
        ].join(" ")}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <div className="mt-1 text-xs text-black/70">{error}</div>
      ) : hint ? (
        <div className="mt-1 text-xs text-black/50">{hint}</div>
      ) : null}
    </label>
  );
}

