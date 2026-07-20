import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthResponse } from "@web-agent/shared";
import { useHealthStore } from "./health";

describe("health store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores the fetched health response", async () => {
    const payload: HealthResponse = {
      status: "ok",
      service: "web-agent",
      time: "2026-07-20T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => payload,
      }),
    );

    const health = useHealthStore();
    await health.fetchHealth();

    expect(health.loading).toBe(false);
    expect(health.error).toBeNull();
    expect(health.data).toEqual(payload);
  });

  it("records an error when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    const health = useHealthStore();
    await health.fetchHealth();

    expect(health.error).toBe("HTTP 500");
    expect(health.data).toBeNull();
  });
});
