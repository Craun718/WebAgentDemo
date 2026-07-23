import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import { accessLogger } from "./logger";
import { chatHandler } from "./chat";
import crypto from "node:crypto";
import type { LoginRequest, LoginResponse, NowResponse } from "@web-agent/shared";
import { SERVICE_NAME, buildHealthResponse } from "@web-agent/shared";

// Load backend/.env if present (Node >= 20.6). Real env vars take precedence.
try {
  process.loadEnvFile();
} catch {
  // no .env in cwd; rely on real environment variables
}

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin";

const validTokens = new Set<string>();

const app = new Hono();

app.use("*", accessLogger);

// 公开路由,不挂鉴权
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
    {
      success: false,
      message: "Invalid username or password",
    } satisfies LoginResponse,
    401,
  );
});

// 统一鉴权:对之后注册的 /api/* 路由生效
const unauthorizedBody = () => ({ success: false, message: "Unauthorized" });
app.use(
  "/api/*",
  bearerAuth({
    verifyToken: (token) => validTokens.has(token),
    noAuthenticationHeader: { message: unauthorizedBody },
    invalidAuthenticationHeader: { message: unauthorizedBody },
    invalidToken: { message: unauthorizedBody },
  }),
);

app.get("/api/now", (c) => {
  const response: NowResponse = { time: new Date().toISOString() };
  return c.json(response);
});

// Chat proxy: forwards an OpenAI-compatible completion (streaming SSE or JSON).
app.post("/api/v1/chat", chatHandler);

// 兜底错误处理
app.onError((err, c) => {
  // Preserve intentional errors (e.g. bearer-auth's 401).
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error("[backend] unhandled error:", err);
  return c.json({ success: false, message: "Internal Server Error" }, 500);
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`[backend] listening on http://${info.address}:${info.port}`);
});

export { app };
