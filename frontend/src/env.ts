export const env = {
  apiBaseUrl:
    (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
    "",
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

