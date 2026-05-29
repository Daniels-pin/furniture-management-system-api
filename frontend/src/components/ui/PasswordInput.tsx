import React, { useId, useState } from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M10.58 10.58A3 3 0 0 0 12 15a3 3 0 0 0 2.42-1.42"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M9.88 5.09A10.94 10.94 0 0 1 12 5c6.5 0 10 7 10 7a18.81 18.81 0 0 1-4.11 5.24"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.61 6.61A18.8 18.8 0 0 0 2 12s3.5 7 10 7a10.94 10.94 0 0 0 5.09-1.12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PasswordInput({ label, hint, error, className, id, ...rest }: Props) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <label className="block" htmlFor={inputId}>
      {label ? <div className="mb-1 text-sm font-medium">{label}</div> : null}
      <div className="relative">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          className={[
            "min-h-11 w-full rounded-xl border bg-white px-3 py-2.5 pr-11 text-base shadow-sm outline-none transition sm:text-sm",
            error ? "border-black/30" : "border-black/15",
            "focus:border-black/40",
            className || ""
          ].join(" ")}
          {...rest}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex min-h-11 min-w-11 items-center justify-center rounded-r-xl px-3 text-black/50 transition hover:text-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {error ? (
        <div className="mt-1 text-xs text-black/70">{error}</div>
      ) : hint ? (
        <div className="mt-1 text-xs text-black/50">{hint}</div>
      ) : null}
    </label>
  );
}
