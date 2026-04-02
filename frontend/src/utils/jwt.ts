function b64UrlToJson(b64Url: string): any {
  const base64 = b64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const decoded = atob(padded);
  return JSON.parse(decoded);
}

export type JwtPayload = {
  user_id?: number;
  role?: "showroom" | "manager" | "factory" | "admin";
  exp?: number;
};

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return b64UrlToJson(parts[1]) as JwtPayload;
  } catch {
    return null;
  }
}

