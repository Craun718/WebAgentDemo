import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentMessage } from "moongazer";
import { useAuthStore } from "./auth";
import { chatMessageContentToText, chatMessageToolCalls, useChatStore } from "./chat";

// Hoisted holders so the module mock factory can read per-run scenarios and
// snapshot the messages passed to agent.run at call time.
const mocks = vi.hoisted(() => ({
  scenarios: [] as AgentEvent[][],
  requestRoles: [] as string[][],
}));

vi.mock("../agent/instance", () => ({
  agent: {
    run: vi.fn(({ messages }: { messages: AgentMessage[] }) => {
      mocks.requestRoles.push(messages.map((m) => m.role));
      const events = mocks.scenarios.shift() ?? [];
      const listeners: Array<(e: AgentEvent) => void> = [];
      const handle = {
        subscribe(fn: (e: AgentEvent) => void) {
          listeners.push(fn);
          return () => {};
        },
        stop() {},
      };
      // Defer to mimic the real agent emitting after subscribe attaches.
      queueMicrotask(() => {
        for (const ev of events) for (const fn of listeners) fn(ev);
      });
      return handle;
    }),
  },
}));

/** A tool round (leading text + one tool call) followed by a final answer. */
function toolRoundThenAnswer(): AgentEvent[] {
  return [
    { type: "assistant_start" },
    { type: "content", delta: "好的，我来帮你查一下当前时间。" },
    {
      type: "tool_calls",
      calls: [{ id: "call_1", name: "get_current_time", arguments: "{}" }],
    },
    { type: "tool_result", id: "call_1", result: "2025/1/1 11:37:00" },
    { type: "assistant_start" },
    { type: "content", delta: "现在是 11:37。" },
    { type: "done" },
  ];
}

describe("chat store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useAuthStore().token = "test-token";
    mocks.scenarios.length = 0;
    mocks.requestRoles.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mirrors events into the leading bubble, tool result, and final bubble", async () => {
    mocks.scenarios.push(toolRoundThenAnswer());

    const chat = useChatStore();
    chat.input = "现在几点了";
    await chat.send();

    expect(chat.streaming).toBe(false);
    // [0] user, [1] assistant (leading + tool call), [2] tool result, [3] final.
    expect(chat.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);

    const leading = chat.messages[1]!;
    expect(chatMessageContentToText(leading)).toBe("好的，我来帮你查一下当前时间。");
    expect(chatMessageToolCalls(leading)[0]!.name).toBe("get_current_time");

    expect(chat.messages[2]!.role).toBe("tool");
    expect(chat.toolResults["call_1"]).toBeTruthy();

    const final = chat.messages[3]!;
    expect(chatMessageContentToText(final)).toBe("现在是 11:37。");
    expect(chatMessageToolCalls(final)).toHaveLength(0);
  });

  it("rebuilds the full history (incl. tool result) on a later send", async () => {
    mocks.scenarios.push(toolRoundThenAnswer());
    const chat = useChatStore();
    chat.input = "第一问";
    await chat.send();

    // Second send: a plain answer with no tool call.
    mocks.requestRoles.length = 0;
    mocks.scenarios.push([
      { type: "assistant_start" },
      { type: "content", delta: "好的。" },
      { type: "done" },
    ]);
    chat.input = "第二问";
    await chat.send();

    // The second send's request must include the prior assistant tool_calls
    // turn AND its tool result, so the provider sees a valid sequence.
    expect(mocks.requestRoles).toHaveLength(1);
    expect(mocks.requestRoles[0]).toEqual(["user", "assistant", "tool", "assistant", "user"]);
  });
});
