import { defineConfig } from "vitest/config";

// shared exposes only types and a trivial buildHealthResponse helper that is
// already exercised end-to-end by the /api/health endpoint, so it intentionally
// has no unit tests. passWithNoTests keeps moon's inferred `test` task green.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    passWithNoTests: true,
  },
});
