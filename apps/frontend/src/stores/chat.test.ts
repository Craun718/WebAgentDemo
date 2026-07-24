import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "./auth";
import {
  chatMessageContentToText,
  chatMessageToolCalls,
  useChatStore,
} from "./chat";

// Hoisted holder so the module mock factory (hoisted above imports) can read
// per-round SSE scenarios and capture the request payloads sent each round.
const mocks = vi.hoisted(() => ({
  scenarios: [] as { events: string[] }[],
  requests: [] as { messages: unknown[] }[],
}));

// Minimal subset of the fetchEventSource config we drive inside the mock.
interface EventSourceConfig {
  onopen: (res: { status: number; ok: boolean }) => unknown;
  onmessage: (ev: { data: string }) => void;
  body?: string;
}

vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async (_url: string, config: unknown) => {
    const cfg = config as EventSourceConfig;
    if (cfg.body) {
      try {
        mocks.requests.push({ messages: JSON.parse(cfg.body).messages });
      } catch {
        // ignore non-JSON bodies
      }
    }
    await cfg.onopen({ status: 200, ok: true });
    const scenario = mocks.scenarios.shift();
    if (scenario) {
      for (const data of scenario.events) cfg.onmessage({ data });
      cfg.onmessage({ data: "[DONE]" });
    }
    return new Response();
  }),
}));

/** Build a minimal streaming chunk carrying the given delta fields. */
function chunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return JSON.stringify({
    id: "x",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

/** A scenario that streams leading text followed by a single tool call. */
function toolRound(
  text: string,
  callId: string,
  name = "get_current_time",
): { events: string[] } {
  return {
    events: [
      chunk({ content: text }),
      chunk(
        {
          tool_calls: [
            { index: 0, id: callId, type: "function", function: { name, arguments: "{}" } },
          ],
        },
        "tool_calls",
      ),
    ],
  };
}

describe("chat store tool-use loop", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useAuthStore().token = "test-token";
    mocks.scenarios.length = 0;
    mocks.requests.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the leading-text bubble and tool result as separate messages", async () => {
    mocks.scenarios.push(toolRound("好的，我来帮你查一下当前时间。", "call_1"));
    mocks.scenarios.push({ events: [chunk({ content: "现在是 11:37。" }, "stop")] });

    const chat = useChatStore();
    chat.input = "现在几点了";
    await chat.send();

    expect(chat.streaming).toBe(false);
    // [0] user, [1] assistant (leading + tool call), [2] tool result, [3] final answer.
    expect(chat.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);

    const leading = chat.messages[1]!;
    // The leading text must survive instead of being overwritten.
    expect(chatMessageContentToText(leading)).toBe("好的，我来帮你查一下当前时间。");
    expect(chatMessageToolCalls(leading)[0]!.function.name).toBe("get_current_time");

    // Tool result is persisted in the list (hidden in the UI) and indexed.
    expect(chat.messages[2]!.role).toBe("tool");
    expect(chat.toolResults["call_1"]).toBeTruthy();

    const final = chat.messages[3]!;
    expect(chatMessageContentToText(final)).toBe("现在是 11:37。");
    // No stale tool calls leaked onto the final bubble.
    expect(chatMessageToolCalls(final)).toHaveLength(0);
  });

  it("rebuilds the full history (incl. tool result) on a later send", async () => {
    // First send: a tool round then a final answer.
    mocks.scenarios.push(toolRound("查一下。", "call_9"));
    mocks.scenarios.push({ events: [chunk({ content: "答案是 42。" }, "stop")] });
    const chat = useChatStore();
    chat.input = "第一问";
    await chat.send();

    // Second send: a plain answer with no tool call.
    mocks.requests.length = 0;
    mocks.scenarios.push({ events: [chunk({ content: "好的。" }, "stop")] });
    chat.input = "第二问";
    await chat.send();

    // The second send's request must include the prior assistant tool_calls
    // turn AND its tool result, so the provider sees a valid sequence.
    expect(mocks.requests).toHaveLength(1);
    const roles = (mocks.requests[0]!.messages as { role: string }[]).map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant", "user"]);
  });
});
