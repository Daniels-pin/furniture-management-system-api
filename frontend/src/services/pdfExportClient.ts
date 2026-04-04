import axios from "axios";
import { env } from "../env";

/** Axios instance for headless PDF export (no auth store / redirect interceptors). */
export function createPdfExportClient(token: string) {
  return axios.create({
    baseURL: env.apiBaseUrl,
    timeout: 120_000,
    headers: { Authorization: `Bearer ${token}` }
  });
}
