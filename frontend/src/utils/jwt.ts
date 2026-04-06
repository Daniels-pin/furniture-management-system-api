function b64UrlToJson(b64Url: string): any {
  const base64 = b64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const decoded = atob(padded);
  return JSON.parse(decoded);
}

export type JwtPayload = {
  user_id?: number;
  role?: "showroom" | "manager" | "factory" | "admin";
  username?: string;
  exp?: number;
  impersonated_by?: number;
  is_impersonation?: boolean;
  impersonation_subject?: string;
};

/** Treat JWT as expired only after this leeway past `exp` (handles slightly fast device clocks). */
export const JWT_CLIENT_EXPIRY_LEEWAY_MS = 120_000;

export function isJwtExpiredForClient(payload: JwtPayload | null): boolean {
  const exp = payload?.exp;
  if (typeof exp !== "number") return false;
  return Date.now() >= exp * 1000 + JWT_CLIENT_EXPIRY_LEEWAY_MS;
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return b64UrlToJson(parts[1]) as JwtPayload;
  } catch {
    return null;
  }
}

