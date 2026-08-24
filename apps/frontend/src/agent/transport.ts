/** Thrown when the proxy rejects the request as unauthorized. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired, please sign in again");
    this.name = "SessionExpiredError";
  }
}

type ChatRequestBody = {
  messages?: unknown[];
};

type ReasoningResolver = (message: Record<string, unknown>) => string | undefined;

/**
 * Keeps the OpenAI SDK's request format while sending it to the app's existing
 * authenticated chat proxy. The SDK is configured with `/api/v1` as its base;
 * this replaces only its `/chat/completions` suffix.
 */
export function createBackendFetch(
  getToken: () => string | null,
  getReasoningContent?: ReasoningResolver,
): typeof fetch {
  return async (input, init) => {
    const url =
      input instanceof Request
        ? new URL(input.url)
        : new URL(input.toString(), globalThis.location?.origin);
    if (url.pathname.endsWith("/chat/completions")) {
      url.pathname = "/api/v1/chat";
    }

    const token = getToken();
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let body: BodyInit | null | undefined =
      input instanceof Request ? await input.text() : init?.body;
    if (getReasoningContent && typeof body === "string" && body !== "") {
      try {
        const parsed = JSON.parse(body) as ChatRequestBody;
        if (Array.isArray(parsed.messages)) {
          for (const message of parsed.messages) {
            if (typeof message !== "object" || message === null) continue;
            const assistant = message as Record<string, unknown>;
            if (assistant.role !== "assistant" || assistant.reasoning_content !== undefined)
              continue;
            const reasoning = getReasoningContent(assistant);
            if (reasoning !== undefined) assistant.reasoning_content = reasoning;
          }
          body = JSON.stringify(parsed);
        }
      } catch {
        // Leave non-JSON request bodies untouched.
      }
    }

    const request = new Request(url, {
      body,
      cache: input instanceof Request ? input.cache : init?.cache,
      credentials: input instanceof Request ? input.credentials : init?.credentials,
      headers,
      integrity: input instanceof Request ? input.integrity : init?.integrity,
      keepalive: input instanceof Request ? input.keepalive : init?.keepalive,
      method: input instanceof Request ? input.method : init?.method,
      mode: input instanceof Request ? input.mode : init?.mode,
      redirect: input instanceof Request ? input.redirect : init?.redirect,
      referrer: input instanceof Request ? input.referrer : init?.referrer,
      signal: input instanceof Request ? input.signal : init?.signal,
    });

    const response = await fetch(request);
    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      throw new SessionExpiredError();
    }
    return response;
  };
}

export function isSessionExpired(error: unknown): boolean {
  if (error instanceof SessionExpiredError) return true;
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401;
}
