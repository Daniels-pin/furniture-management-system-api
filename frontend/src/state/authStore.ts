const TOKEN_KEY = "furniture_access_token";
const IMPERSONATION_RESTORE_KEY = "furniture_impersonation_restore_token";

export const authStore = {
  getToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  getImpersonationRestoreToken(): string | null {
    try {
      return localStorage.getItem(IMPERSONATION_RESTORE_KEY);
    } catch {
      return null;
    }
  },
  setToken(token: string): boolean {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      return true;
    } catch {
      return false;
    }
  },
  setImpersonationRestoreToken(token: string): boolean {
    try {
      localStorage.setItem(IMPERSONATION_RESTORE_KEY, token);
      return true;
    } catch {
      return false;
    }
  },
  clearImpersonationRestoreToken() {
    try {
      localStorage.removeItem(IMPERSONATION_RESTORE_KEY);
    } catch {
      // ignore
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(IMPERSONATION_RESTORE_KEY);
    } catch {
      // ignore
    }
  }
};
