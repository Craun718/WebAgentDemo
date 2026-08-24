import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackendFetch, SessionExpiredError } from "./transport";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createBackendFetch", () => {
  it("rewrites the OpenAI chat completions URL and adds the auth token", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await createBackendFetch(() => "session-token")(
      "http://localhost:3000/api/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ model: "", messages: [] }),
      },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.url).toBe("http://localhost:3000/api/v1/chat");
    expect(request.method).toBe("POST");
    expect(request.headers.get("Authorization")).toBe("Bearer session-token");
    expect(await request.text()).toBe(JSON.stringify({ model: "", messages: [] }));
  });

  it("keeps Request bodies and URLs intact while rewriting the endpoint", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify({ model: "", stream: true });

    await createBackendFetch(() => "session-token")(
      new Request("https://api.example.test/v1/chat/completions", {
        method: "POST",
        body,
      }),
    );

    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.url).toBe("https://api.example.test/api/v1/chat");
    expect(request.headers.get("Authorization")).toBe("Bearer session-token");
    expect(await request.text()).toBe(body);
  });

  it("adds reasoning content to replayed assistant tool calls", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createBackendFetch(
      () => "session-token",
      (message) =>
        (message.tool_calls as Array<{ id?: string }> | undefined)?.[0]?.id === "call_1"
          ? "check the map first"
          : undefined,
    )("http://localhost:3000/api/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { role: "user", content: "take me to Guangxi" },
          { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function" }] },
        ],
      }),
    });

    const request = fetchMock.mock.calls[0]![0] as Request;
    const body = JSON.parse(await request.text()) as {
      messages: Array<{ role: string; reasoning_content?: string }>;
    };
    expect(body.messages[0]).not.toHaveProperty("reasoning_content");
    expect(body.messages[1]?.reasoning_content).toBe("check the map first");
  });

  it("adds reasoning content to a replayed assistant text message", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createBackendFetch(
      () => "session-token",
      (message) => (message.content === "I will fly there." ? "flight reasoning" : undefined),
    )("http://localhost:3000/api/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "assistant", content: "I will fly there." }],
      }),
    });

    const request = fetchMock.mock.calls[0]![0] as Request;
    const body = JSON.parse(await request.text()) as {
      messages: Array<{ reasoning_content?: string }>;
    };
    expect(body.messages[0]?.reasoning_content).toBe("flight reasoning");
  });

  it("does not overwrite reasoning content already present in the request", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const resolver = vi.fn(() => "replacement reasoning");

    await createBackendFetch(() => "session-token", resolver)(
      "http://localhost:3000/api/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "assistant", reasoning_content: "original reasoning" }],
        }),
      },
    );

    const request = fetchMock.mock.calls[0]![0] as Request;
    const body = JSON.parse(await request.text()) as {
      messages: Array<{ reasoning_content?: string }>;
    };
    expect(body.messages[0]?.reasoning_content).toBe("original reasoning");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("throws the session expiry error for unauthorized responses", async () => {
    const fetchMock = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createBackendFetch(() => "expired")("http://localhost:3000/api/v1/chat/completions", {
        method: "POST",
      }),
    ).rejects.toBeInstanceOf(SessionExpiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
