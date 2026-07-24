import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { OpenAIChatChunk, OpenAIRawRequest, OpenAIRawStream } from "moongazer";

/** Thrown when the proxy rejects the request as unauthorized. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired, please sign in again");
    this.name = "SessionExpiredError";
  }
}

/**
 * Build a raw OpenAI-compatible stream backed by the backend's `/api/v1/chat`
 * SSE endpoint. The token is read lazily on each request via `getToken` so it
 * always reflects the current auth state.
 *
 * Bridges fetch-event-source's push model into an async iterable so moongazer's
 * transport can consume it with `for await`.
 */
export function createRawStream(getToken: () => string | null): OpenAIRawStream {
  return (request, signal) => createStream(request, signal, getToken());
}

function createStream(
  request: OpenAIRawRequest,
  signal: AbortSignal,
  token: string | null,
): AsyncIterable<OpenAIChatChunk> {
  const queue: OpenAIChatChunk[] = [];
  let pending: ((result: IteratorResult<OpenAIChatChunk>) => void) | null = null;
  let done = false;
  let streamError: unknown = null;

  const push = (chunk: OpenAIChatChunk): void => {
    if (done) return;
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve({ value: chunk, done: false });
    } else {
      queue.push(chunk);
    }
  };

  const finish = (error?: unknown): void => {
    if (done) return;
    done = true;
    streamError = error ?? null;
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve({ value: undefined, done: true });
    }
  };

  void fetchEventSource("/api/v1/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...request, stream: true }),
    signal,
    openWhenHidden: true,
    async onopen(res) {
      if (res.status === 401) throw new SessionExpiredError();
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
    },
    onmessage(ev) {
      if (ev.data === "[DONE]") return;
      try {
        push(JSON.parse(ev.data) as OpenAIChatChunk);
      } catch {
        // ignore non-JSON keepalive/partial frames
      }
    },
    onerror(err) {
      // Throw to stop fetch-event-source from auto-reconnecting.
      throw err;
    },
  }).then(
    () => finish(),
    (err) => finish(err),
  );

  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<OpenAIChatChunk>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift() as OpenAIChatChunk, done: false });
          }
          if (done) {
            if (streamError) return Promise.reject(streamError);
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            pending = resolve;
          });
        },
        return(): Promise<IteratorResult<OpenAIChatChunk>> {
          finish();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}
