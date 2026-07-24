import { fetchEventSource } from "@microsoft/fetch-event-source";
import { defineStore } from "pinia";
import type { ChatMessage, ChatRequest } from "@web-agent/shared";
import { useAuthStore } from "./auth";
import { getTool, toApiTools } from "../tools";
import {
  type AccumulatedToolCall,
  accumulateChunk,
  createAccumulator,
  finalizeToolCalls,
} from "../tools/accumulate";

/** Maximum tool round-trips before we give up to avoid runaway loops. */
const MAX_STEPS = 6;

interface ChatState {
  messages: ChatMessage[];
  input: string;
  streaming: boolean;
  error: string | null;
  toolResults: Record<string, string>;
}

export function chatMessageContentToText(message: ChatMessage | undefined): string {
  const content = message?.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      if ("text" in part && typeof part.text === "string") return part.text;
      if ("refusal" in part && typeof part.refusal === "string") {
        return part.refusal;
      }
      return "";
    })
    .join("");
}

/** Function-typed tool calls attached to an assistant message (empty if none). */
export function chatMessageToolCalls(message: ChatMessage | undefined): AccumulatedToolCall[] {
  if (!message || message.role !== "assistant") return [];
  const calls = message.tool_calls;
  if (!Array.isArray(calls)) return [];
  const result: AccumulatedToolCall[] = [];
  for (const c of calls) {
    if (c.type === "function" && c.function) {
      result.push({
        id: c.id,
        type: "function",
        function: { name: c.function.name, arguments: c.function.arguments },
      });
    }
  }
  return result;
}

// Controller for the in-flight request; lets the user stop generation.
let activeController: AbortController | null = null;

/** Thrown when the proxy rejects the request as unauthorized. */
class SessionExpiredError extends Error {
  constructor() {
    super("Session expired, please sign in again");
    this.name = "SessionExpiredError";
  }
}

/** Parse JSON tool-call arguments, tolerating empty/invalid payloads. */
function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Run a single streaming completion request, resolving with the assembled tool calls. */
async function streamOnce(
  payload: ChatRequest,
  token: string,
  signal: AbortSignal,
  onContent: (text: string) => void,
  onToolCalls: (calls: AccumulatedToolCall[]) => void,
): Promise<{ toolCalls: AccumulatedToolCall[]; aborted: boolean }> {
  const acc = createAccumulator();

  await fetchEventSource("/api/v1/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal,
    openWhenHidden: true,
    async onopen(res) {
      if (res.status === 401) {
        throw new SessionExpiredError();
      }
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
    },
    onmessage(ev) {
      if (ev.data === "[DONE]") return;
      try {
        accumulateChunk(acc, JSON.parse(ev.data));
      } catch {
        // ignore non-JSON keepalive/partial frames
      }
      if (acc.content) onContent(acc.content);
      const calls = finalizeToolCalls(acc);
      if (calls.length) onToolCalls(calls);
    },
    onerror(err) {
      // Throw to stop fetch-event-source from auto-reconnecting.
      throw err;
    },
  });

  return { toolCalls: finalizeToolCalls(acc), aborted: signal.aborted };
}

export const useChatStore = defineStore("chat", {
  state: (): ChatState => ({
    messages: [],
    input: "",
    streaming: false,
    error: null,
    toolResults: {},
  }),
  actions: {
    async send() {
      const auth = useAuthStore();
      const content = this.input.trim();
      if (!auth.token || !content || this.streaming) return;

      // `this.messages` is the single source of truth for both the UI and the
      // API conversation: it holds the full OpenAI message sequence, including
      // `tool` result messages (which the UI hides). Keeping tool results in
      // the list means a later send rebuilds a valid history instead of a
      // dangling assistant tool_calls turn with no matching tool result.
      this.messages.push({ role: "user", content }, { role: "assistant", content: "" });
      // `activeIndex` tracks the assistant bubble currently being streamed
      // into. Each tool round gets its own bubble, and the API payload for a
      // round is everything before this index (excludes the placeholder).
      let activeIndex = this.messages.length - 1;
      this.input = "";
      this.streaming = true;
      this.error = null;

      const setAssistant = (index: number, patch: Record<string, unknown>) => {
        const current = this.messages[index];
        if (!current || current.role !== "assistant") return;
        this.messages[index] = { ...current, ...patch } as ChatMessage;
      };

      activeController = new AbortController();
      const apiTools = toApiTools();
      let steps = 0;

      try {
        // Tool-use loop: stream, execute requested tools, feed results back,
        // repeat until the model answers without calling a tool.
        for (;;) {
          steps += 1;
          // Stream into the current assistant bubble.
          const idx = activeIndex;

          const result = await streamOnce(
            {
              messages: this.messages.slice(0, idx),
              stream: true,
              tools: apiTools.length ? apiTools : undefined,
              tool_choice: apiTools.length ? "auto" : undefined,
            },
            auth.token,
            activeController.signal,
            (text) => setAssistant(idx, { content: text }),
            (calls) => setAssistant(idx, { tool_calls: calls }),
          );

          if (result.aborted) break;

          const calledTools = result.toolCalls;
          if (calledTools.length === 0) break;

          // Providers expect null (not "") when an assistant turn emits only
          // tool calls; empty and null render identically in the UI.
          if (!chatMessageContentToText(this.messages[idx])) {
            setAssistant(idx, { content: null });
          }

          // Append a tool result message per call directly into `this.messages`
          // so the next round (and any later send) sees a complete sequence.
          for (const call of calledTools) {
            const tool = getTool(call.function.name);
            const args = parseArgs(call.function.arguments);
            const outcome = tool ? await tool.execute(args) : `Unknown tool: ${call.function.name}`;
            const resultText = typeof outcome === "string" ? outcome : JSON.stringify(outcome);
            this.toolResults[call.id] = resultText;
            this.messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: resultText,
            } as ChatMessage);
          }

          // Guard before allocating the next bubble so the step limit never
          // leaves a dangling empty assistant message.
          if (steps >= MAX_STEPS) break;

          // Next round streams into a fresh assistant bubble.
          this.messages.push({ role: "assistant", content: "" });
          activeIndex = this.messages.length - 1;
        }
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          auth.logout();
          this.error = err.message;
        } else if (!activeController?.signal.aborted) {
          this.error = err instanceof Error ? err.message : String(err);
        }
      } finally {
        const aborted = activeController?.signal.aborted === true;
        const finalText = chatMessageContentToText(this.messages[activeIndex]);
        if (aborted) {
          if (!finalText) setAssistant(activeIndex, { content: "(stopped)" });
        } else if (!this.error && !finalText) {
          setAssistant(activeIndex, { content: "(no response)" });
        }
        activeController = null;
        this.streaming = false;
      }
    },
    /** Abort the in-flight stream, keeping whatever was already received. */
    stop() {
      activeController?.abort();
    },
    clear() {
      this.stop();
      this.messages = [];
      this.error = null;
      this.toolResults = {};
    },
  },
});
