import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { accessLogger } from "./logger";
import crypto from "node:crypto";
import type { LoginRequest, LoginResponse, NowResponse } from "@web-agent/shared";
import { SERVICE_NAME, buildHealthResponse } from "@web-agent/shared";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin";

const validTokens = new Set<string>();

const app = new Hono();

app.use("*", accessLogger);

app.get("/api/health", (c) => {
  return c.json(buildHealthResponse(SERVICE_NAME));
});

app.post("/api/login", async (c) => {
  const body = (await c.req.json()) as LoginRequest;

  if (body.username === ADMIN_USERNAME && body.password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString("hex");
    validTokens.add(token);
    const response: LoginResponse = { success: true, token };
    return c.json(response);
  }

  return c.json(
    { success: false, message: "Invalid username or password" } satisfies LoginResponse,
    401,
  );
});

app.get("/api/now", (c) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return c.json({ success: false, message: "Unauthorized" }, 401);
  }
  const token = auth.slice(7);
  if (!validTokens.has(token)) {
    return c.json({ success: false, message: "Unauthorized" }, 401);
  }
  const response: NowResponse = { time: new Date().toISOString() };
  return c.json(response);
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`[backend] listening on http://${info.address}:${info.port}`);
});

export { app };