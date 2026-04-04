import axios, { AxiosError } from "axios";
import { env } from "../env";
import { authStore } from "../state/authStore";
import { decodeJwt, isJwtExpiredForClient } from "../utils/jwt";

export type ApiErrorShape =
  | { detail?: string }
  | { detail?: Array<{ loc?: unknown[]; msg?: string; type?: string }> };

export function getErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;

  if (axios.isAxiosError(err)) {
    const e = err as AxiosError<ApiErrorShape>;
    const data = e.response?.data;
    const status = e.response?.status;

    if (data && typeof data === "object" && "detail" in data) {
      const detail = (data as any).detail;
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg as string;
    }

    if (status === 0) return "Network error";
    if (status) return `Request failed (${status})`;
    return "Request failed";
  }

  if (err instanceof Error) return err.message;
  return "Unknown error";
}

export const api = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: 20000
});

function sleep(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms));
}

function isTokenExpired(token: string): boolean {
  return isJwtExpiredForClient(decodeJwt(token));
}

function shouldRetry(config: any, status?: number): boolean {
  const method = String(config?.method || "get").toLowerCase();
  // Only retry safe/idempotent requests
  if (!["get", "head", "options"].includes(method)) return false;
  if (!status) return true; // network / no response
  // Render cold start / transient errors (per requirements, include 404 retry)
  return status === 404 || status === 502 || status === 503 || status === 504;
}

api.interceptors.request.use((config) => {
  const token = authStore.getToken();
  if (token) {
    // If token is expired, clear it and let RequireAuth redirect cleanly.
    if (isTokenExpired(token)) {
      authStore.clear();
      if (window.location.pathname !== "/login") window.location.assign("/login");
      return config;
    }
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;

    // Central auth handling
    if (status === 401) {
      authStore.clear();
      // Avoid hard navigation loops; RequireAuth will redirect.
      if (window.location.pathname !== "/login") window.location.assign("/login");
      return Promise.reject(error);
    }

    const config = error?.config;
    if (!config) return Promise.reject(error);

    // Retry logic (Render sleep/cold start etc.)
    const attempt = Number(config.__retryAttempt || 0);
    const maxAttempts = 2;
    if (attempt < maxAttempts && shouldRetry(config, status)) {
      config.__retryAttempt = attempt + 1;
      const delay = attempt === 0 ? 2000 : 4500;

      // Lightweight production debugging signal
      try {
        console.warn("[api] retrying", {
          url: config?.url,
          method: config?.method,
          status: status ?? "NETWORK",
          attempt: config.__retryAttempt,
          delayMs: delay
        });
      } catch {
        // ignore
      }

      await sleep(delay);
      return api.request(config);
    }

    return Promise.reject(error);
  }
);

