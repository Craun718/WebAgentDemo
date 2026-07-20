import { describe, expect, it } from "vitest";
import { SERVICE_NAME, buildHealthResponse } from "./index";

describe("shared", () => {
  it("exposes a service name", () => {
    expect(SERVICE_NAME).toBe("web-agent");
  });

  it("builds a health response", () => {
    const result = buildHealthResponse(SERVICE_NAME);
    expect(result.status).toBe("ok");
    expect(result.service).toBe("web-agent");
  });
});
