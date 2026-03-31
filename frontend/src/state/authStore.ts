const TOKEN_KEY = "furniture_access_token";

export const authStore = {
  getToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  setToken(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
  }
};

