import type { Context, Next } from "hono";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const LOG_DIR = join(process.cwd(), "logs");

async function ensureLogDir() {
  await mkdir(LOG_DIR, { recursive: true });
}

let dirReady: Promise<void> | undefined;

function logFile(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(LOG_DIR, `access-${date}.log`);
}

function formatLine(
  method: string,
  path: string,
  ip: string,
  status: number,
  elapsed: number,
  ua: string,
): string {
  return `[${new Date().toISOString()}] ${method} ${path} ${ip} ${status} ${elapsed}ms ${ua}\n`;
}

export async function accessLogger(c: Context, next: Next) {
  const start = Date.now();

  await next();

  const elapsed = Date.now() - start;
  const method = c.req.method;
  const path = c.req.path;
  const ua = c.req.header("user-agent") ?? "-";
  const xff = c.req.header("x-forwarded-for");
  const raw = (c.env as Record<string, unknown>)?.incoming as
    | { socket?: { remoteAddress?: string } }
    | undefined;
  const ip = xff ?? raw?.socket?.remoteAddress ?? "-";

  const line = formatLine(method, path, ip, c.res.status, elapsed, ua);

  // console output
  console.log(line.trimEnd());

  // file output
  if (!dirReady) dirReady = ensureLogDir();
  try {
    await dirReady;
    await appendFile(logFile(), line, "utf-8");
  } catch {
    // ignore write errors
  }
}