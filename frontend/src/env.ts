const rawApiBase =
  (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
  "";

const devDefaultApi = "http://localhost:8000";

export const env = {
  apiBaseUrl: rawApiBase || (import.meta.env.DEV ? devDefaultApi : ""),
  /** Same absolute URL as API INVOICE_LOGO_URL / PUBLIC_LOGO_URL so PDF export and email match. */
  logoUrl:
    (import.meta.env.VITE_LOGO_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_PUBLIC_LOGO_URL as string | undefined)?.trim() ||
    ""
};

if (!env.apiBaseUrl) {
  // Keep failure explicit to avoid silent production misconfigurations.
  throw new Error(
    "Missing API base URL. Set VITE_API_URL (or VITE_API_BASE_URL) in your Vite environment."
  );
}

if (import.meta.env.DEV && !rawApiBase) {
  console.warn(
    `[env] VITE_API_URL is not set; using dev default ${devDefaultApi}. Copy frontend/.env.example to frontend/.env and set VITE_API_URL if your API runs elsewhere.`
  );
}

