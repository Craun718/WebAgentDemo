import type { ChatCompletionChunk } from "@web-agent/shared";

/** Minimal structural shape of a tool-call delta received while streaming. */
interface DeltaToolCall {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

/** Internal accumulator slot; fields are required once a slot is created. */
interface SlotToolCall {
  index: number;
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/**
 * State accumulated across the SSE chunks of a single completion request.
 * `content` is the concatenated text; `toolCalls` is merged by delta `index`
 * so the model's incremental argument fragments are reassembled correctly.
 * `finishReason` is the last `finish_reason` observed.
 */
export interface AccumulatedDelta {
  content: string;
  toolCalls: SlotToolCall[];
  finishReason: string | null;
}

/** Shape of a tool call once fully assembled, matching the API message type. */
export interface AccumulatedToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export function createAccumulator(): AccumulatedDelta {
  return { content: "", toolCalls: [], finishReason: null };
}

/**
 * Merge one streaming chunk into the accumulator. Tool-call deltas are keyed by
 * their `index` field: the model streams `id`/`function.name` once and then
 * `function.arguments` as a sequence of JSON string fragments that we append.
 */
export function accumulateChunk(acc: AccumulatedDelta, chunk: ChatCompletionChunk): void {
  const choice = chunk.choices?.[0];
  if (!choice) return;

  if (choice.finish_reason) acc.finishReason = choice.finish_reason;

  const delta = choice.delta;
  if (!delta) return;

  if (typeof delta.content === "string") acc.content += delta.content;

  const calls = delta.tool_calls as DeltaToolCall[] | undefined;
  if (calls && calls.length > 0) {
    for (const incoming of calls) {
      const idx = incoming.index;
      let slot = acc.toolCalls[idx];
      if (!slot) {
        slot = { index: idx, id: "", type: "function", function: { name: "", arguments: "" } };
        acc.toolCalls[idx] = slot;
      }
      if (incoming.id) slot.id = incoming.id;
      if (incoming.type) slot.type = incoming.type;
      if (incoming.function?.name) {
        slot.function.name += incoming.function.name;
      }
      if (typeof incoming.function?.arguments === "string") {
        slot.function.arguments += incoming.function.arguments;
      }
    }
  }
}

/**
 * Compact the accumulator's tool calls into the form expected on the assistant
 * message (`tool_calls`) and in subsequent request payloads, dropping the
 * transient `index` field. Returns an empty array when none were called.
 */
export function finalizeToolCalls(acc: AccumulatedDelta): AccumulatedToolCall[] {
  return acc.toolCalls
    .filter((tc): tc is SlotToolCall => tc !== undefined)
    .map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
}
