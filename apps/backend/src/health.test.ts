import { describe, expect, it } from "vitest";
import { buildHealthResponse } from "@web-agent/shared";

describe("buildHealthResponse", () => {
  it("returns an ok status with the provided service", () => {
    const result = buildHealthResponse("web-agent");
    expect(result.status).toBe("ok");
    expect(result.service).toBe("web-agent");
    expect(typeof result.time).toBe("string");
  });
});
