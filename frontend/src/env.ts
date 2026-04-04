export const env = {
  apiBaseUrl:
    (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
    "http://localhost:8000",
  /** Same absolute URL as API INVOICE_LOGO_URL / PUBLIC_LOGO_URL so PDF export and email match. */
  logoUrl:
    (import.meta.env.VITE_LOGO_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_PUBLIC_LOGO_URL as string | undefined)?.trim() ||
    ""
};

