import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { SERVICE_NAME, buildHealthResponse } from "@web-agent/shared";

const app = new Hono();

app.get("/api/health", (c) => {
  return c.json(buildHealthResponse(SERVICE_NAME));
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`[backend] listening on http://${info.address}:${info.port}`);
});

export { app };
