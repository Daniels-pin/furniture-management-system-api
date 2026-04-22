import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authStore } from "./authStore";
import { decodeJwt, isJwtExpiredForClient, JwtPayload } from "../utils/jwt";
import { adminApi } from "../services/endpoints";

export type Role = "showroom" | "factory" | "admin" | "finance";

type AuthState = {
  token: string | null;
  role: Role | null;
  userId: number | null;
  username: string | null;
  isImpersonation: boolean;
  impersonationSubject: string | null;
};

type AuthContextValue = AuthState & {
  login(token: string): void;
  beginImpersonation(accessToken: string, restoreToken: string): void;
  exitImpersonation(): Promise<void>;
  logout(): void;
  isAuthed: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isExpired(payload: JwtPayload | null): boolean {
  return isJwtExpiredForClient(payload);
}

function deriveState(token: string | null): AuthState {
  if (!token) {
    return {
      token: null,
      role: null,
      userId: null,
      username: null,
      isImpersonation: false,
      impersonationSubject: null
    };
  }
  const payload = decodeJwt(token) as JwtPayload | null;
  if (isExpired(payload)) {
    authStore.clear();
    return {
      token: null,
      role: null,
      userId: null,
      username: null,
      isImpersonation: false,
      impersonationSubject: null
    };
  }
  const normalizedRole =
    payload?.role === "manager" ? ("factory" as Role) : ((payload?.role as Role | undefined) ?? null);
  const isImpersonation = payload?.is_impersonation === true;
  const subject =
    typeof payload?.impersonation_subject === "string" && payload.impersonation_subject.trim()
      ? payload.impersonation_subject.trim()
      : null;
  return {
    token,
    role: normalizedRole,
    userId: typeof payload?.user_id === "number" ? payload.user_id : null,
    username: typeof payload?.username === "string" && payload.username.trim() ? payload.username.trim() : null,
    isImpersonation,
    impersonationSubject: isImpersonation ? subject ?? payload?.username?.trim() ?? null : null
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => deriveState(authStore.getToken()));

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "furniture_access_token" || e.key === "furniture_impersonation_restore_token") {
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
        authStore.clear();
        if (!authStore.setToken(token)) {
          throw new Error(
            "Could not save your session (storage blocked). Try turning off private browsing or freeing space."
          );
        }
        setState(deriveState(token));
      },
      beginImpersonation: (accessToken: string, restoreToken: string) => {
        const previousToken = authStore.getToken();
        if (!authStore.setImpersonationRestoreToken(restoreToken)) {
          throw new Error("Could not save impersonation restore data.");
        }
        if (!authStore.setToken(accessToken)) {
          authStore.clearImpersonationRestoreToken();
          if (previousToken) authStore.setToken(previousToken);
          throw new Error(
            "Could not save your session (storage blocked). Try turning off private browsing or freeing space."
          );
        }
        setState(deriveState(accessToken));
      },
      exitImpersonation: async () => {
        const restore = authStore.getImpersonationRestoreToken();
        if (!restore) {
          throw new Error("Missing restore token. Log in again as admin.");
        }
        const res = await adminApi.stopImpersonation({ restore_token: restore });
        authStore.clearImpersonationRestoreToken();
        if (!authStore.setToken(res.access_token)) {
          throw new Error("Could not restore admin session.");
        }
        setState(deriveState(res.access_token));
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
