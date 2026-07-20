import { defineStore } from "pinia";
import type { LoginResponse, NowResponse } from "@web-agent/shared";

interface AuthState {
  token: string | null;
  error: string | null;
  loading: boolean;
  serverTime: string | null;
}

function loadToken(): string | null {
  try {
    return localStorage.getItem("auth_token");
  } catch {
    return null;
  }
}

function saveToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem("auth_token", token);
    } else {
      localStorage.removeItem("auth_token");
    }
  } catch {
    // localStorage unavailable
  }
}

export const useAuthStore = defineStore("auth", {
  state: (): AuthState => ({
    token: loadToken(),
    error: null,
    loading: false,
    serverTime: null,
  }),
  getters: {
    isAuthenticated: (state): boolean => state.token !== null,
  },
  actions: {
    async login(username: string, password: string) {
      this.loading = true;
      this.error = null;
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = (await res.json()) as LoginResponse;
        if (!data.success) {
          this.error = data.message;
          return false;
        }
        this.token = data.token;
        saveToken(data.token);
        return true;
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        return false;
      } finally {
        this.loading = false;
      }
    },
    async fetchNow() {
      if (!this.token) return;
      try {
        const res = await fetch("/api/now", {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        if (!res.ok) {
          if (res.status === 401) {
            this.logout();
          }
          return;
        }
        const data = (await res.json()) as NowResponse;
        this.serverTime = data.time;
      } catch {
        // ignore
      }
    },
    logout() {
      this.token = null;
      this.serverTime = null;
      this.error = null;
      saveToken(null);
    },
  },
});