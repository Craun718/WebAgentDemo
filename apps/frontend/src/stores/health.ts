import { defineStore } from "pinia";
import type { HealthResponse } from "@web-agent/shared";

interface HealthState {
  data: HealthResponse | null;
  error: string | null;
  loading: boolean;
}

export const useHealthStore = defineStore("health", {
  state: (): HealthState => ({
    data: null,
    error: null,
    loading: false,
  }),
  actions: {
    async fetchHealth() {
      this.loading = true;
      this.error = null;
      try {
        const res = await fetch("/api/health");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        this.data = (await res.json()) as HealthResponse;
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loading = false;
      }
    },
  },
});
