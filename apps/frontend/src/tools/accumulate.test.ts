import { describe, expect, it } from "vitest";
import type { ChatCompletionChunk } from "@web-agent/shared";
import { accumulateChunk, createAccumulator, finalizeToolCalls } from "./accumulate";

/** Build a minimal streaming chunk carrying the given delta fields. */
function chunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): ChatCompletionChunk {
  return {
    id: "x",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  } as unknown as ChatCompletionChunk;
}

describe("accumulateChunk", () => {
  it("concatenates content deltas", () => {
    const acc = createAccumulator();
    accumulateChunk(acc, chunk({ content: "Hel" }));
    accumulateChunk(acc, chunk({ content: "lo" }));
    expect(acc.content).toBe("Hello");
  });

  it("reassembles a tool call whose arguments arrive in fragments", () => {
    const acc = createAccumulator();
    // The model typically sends id+name first, then arguments in pieces.
    accumulateChunk(
      acc,
      chunk({
        tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get" } }],
      }),
    );
    accumulateChunk(
      acc,
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }),
    );
    accumulateChunk(
      acc,
      chunk({ tool_calls: [{ index: 0, function: { arguments: ' "Paris"}' } }] }),
    );

    const calls = finalizeToolCalls(acc);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      id: "call_1",
      type: "function",
      function: { name: "get", arguments: '{"city": "Paris"}' },
    });
  });

  it("tracks multiple tool calls by their index", () => {
    const acc = createAccumulator();
    accumulateChunk(acc, chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "f1" } }] }));
    accumulateChunk(acc, chunk({ tool_calls: [{ index: 1, id: "b", function: { name: "f2" } }] }));
    const calls = finalizeToolCalls(acc);
    expect(calls.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("records the finish reason", () => {
    const acc = createAccumulator();
    accumulateChunk(acc, chunk({ content: "hi" }, "tool_calls"));
    expect(acc.finishReason).toBe("tool_calls");
    expect(finalizeToolCalls(acc)).toHaveLength(0);
  });

  it("ignores chunks without choices", () => {
    const acc = createAccumulator();
    accumulateChunk(acc, { choices: [] } as unknown as ChatCompletionChunk);
    expect(acc.content).toBe("");
    expect(finalizeToolCalls(acc)).toEqual([]);
  });
});
