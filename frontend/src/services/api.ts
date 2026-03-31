import axios, { AxiosError } from "axios";
import { env } from "../env";
import { authStore } from "../state/authStore";

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

api.interceptors.request.use((config) => {
  const token = authStore.getToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      authStore.clear();
      // Avoid hard navigation loops; RequireAuth will redirect.
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }
    return Promise.reject(error);
  }
);

