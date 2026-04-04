import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authStore } from "./authStore";
import { decodeJwt, isJwtExpiredForClient, JwtPayload } from "../utils/jwt";

export type Role = "showroom" | "factory" | "admin";

type AuthState = {
  token: string | null;
  role: Role | null;
  userId: number | null;
  username: string | null;
};

type AuthContextValue = AuthState & {
  login(token: string): void;
  logout(): void;
  isAuthed: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isExpired(payload: JwtPayload | null): boolean {
  return isJwtExpiredForClient(payload);
}

function deriveState(token: string | null): AuthState {
  if (!token) return { token: null, role: null, userId: null, username: null };
  const payload = decodeJwt(token) as JwtPayload | null;
  if (isExpired(payload)) {
    authStore.clear();
    return { token: null, role: null, userId: null, username: null };
  }
  const normalizedRole =
    payload?.role === "manager" ? ("factory" as Role) : ((payload?.role as Role | undefined) ?? null);
  return {
    token,
    role: normalizedRole,
    userId: typeof payload?.user_id === "number" ? payload.user_id : null,
    username: typeof payload?.username === "string" && payload.username.trim() ? payload.username.trim() : null
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => deriveState(authStore.getToken()));

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "furniture_access_token") {
        setState(deriveState(authStore.getToken()));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isAuthed: Boolean(state.token),
      login: (token: string) => {
        if (!authStore.setToken(token)) {
          throw new Error(
            "Could not save your session (storage blocked). Try turning off private browsing or freeing space."
          );
        }
        setState(deriveState(token));
      },
      logout: () => {
        authStore.clear();
        setState(deriveState(null));
      }
    }),
    [state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

