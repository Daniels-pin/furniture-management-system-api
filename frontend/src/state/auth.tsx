import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authStore } from "./authStore";
import { decodeJwt, JwtPayload } from "../utils/jwt";

export type Role = "showroom" | "manager" | "admin";

type AuthState = {
  token: string | null;
  role: Role | null;
  userId: number | null;
};

type AuthContextValue = AuthState & {
  login(token: string): void;
  logout(): void;
  isAuthed: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function deriveState(token: string | null): AuthState {
  if (!token) return { token: null, role: null, userId: null };
  const payload = decodeJwt(token) as JwtPayload | null;
  return {
    token,
    role: (payload?.role as Role | undefined) ?? null,
    userId: typeof payload?.user_id === "number" ? payload.user_id : null
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
        authStore.setToken(token);
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

