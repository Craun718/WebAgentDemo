import { defineStore } from "pinia";
import type { AgentEvent, AgentMessage, AgentRunHandle, ToolCallPart } from "moongazer";
import { useAuthStore } from "./auth";
import { agent } from "../agent/instance";
import { SessionExpiredError } from "../agent/transport";

interface ChatState {
  messages: AgentMessage[];
  input: string;
  streaming: boolean;
  error: string | null;
  toolResults: Record<string, string>;
  /** Per-message index -> reasoning text, preserved across turns. */
  reasoning: Record<number, string>;
}

export function chatMessageContentToText(message: AgentMessage | undefined): string {
  return message?.content ?? "";
}

/** Tool calls attached to an assistant message (empty if none). */
export function chatMessageToolCalls(message: AgentMessage | undefined): ToolCallPart[] {
  if (!message || message.role !== "assistant") return [];
  return message.toolCalls ?? [];
}

// Handle for the in-flight run; lets the user stop generation.
let activeHandle: AgentRunHandle | null = null;

export const useChatStore = defineStore("chat", {
  state: (): ChatState => ({
    messages: [],
    input: "",
    streaming: false,
    error: null,
    toolResults: {},
    reasoning: {},
  }),
  actions: {
    /**
     * Send the current input as a new user turn. Appends the user message,
     * starts an agent run over the full conversation history, and mirrors the
     * run's event stream back into the store so the UI updates in real time.
     */
    async send() {
      const auth = useAuthStore();
      const content = this.input.trim();
      // Bail out silently when there's nothing to send or a turn is in flight.
      if (!auth.token || !content || this.streaming) return;

      // `this.messages` is the single source of truth for both the UI and the
      // agent conversation. The agent reads a snapshot of it as the initial
      // context and emits events that we mirror back here, so a later send
      // rebuilds a valid history including tool results.
      this.messages.push({ role: "user", content });
      this.input = "";
      this.streaming = true;
      this.error = null;

      // Index of the assistant message currently being built by this run.
      let activeIndex = -1;
      // Patch the in-progress assistant message in place (immutably).
      const setAssistant = (patch: Partial<AgentMessage>): void => {
        const current = this.messages[activeIndex];
        if (!current || current.role !== "assistant") return;
        this.messages[activeIndex] = { ...current, ...patch };
      };

      // Start the run over the full history; the handle lets us subscribe to
      // events and stop generation mid-stream.
      activeHandle = agent.run({ messages: this.messages });

      // A promise that resolves once the run ends (done/abort/error), so send
      // can await completion before returning.
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      // One-shot teardown: clears the handle, ends the streaming state, and
      // resolves `done`. Guarded by `finished` so it runs at most once.
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        activeHandle = null;
        this.streaming = false;
        resolveDone();
      };

      // Subscribe to the run's event stream and mirror each event into the
      // store. The returned function unsubscribes the listener on cleanup.
      const unsubscribe = activeHandle.subscribe((event: AgentEvent) => {
        switch (event.type) {
          case "assistant_start":
            // Begin a fresh assistant message; remember its index for patches.
            this.messages.push({ role: "assistant", content: "" });
            activeIndex = this.messages.length - 1;
            this.reasoning[activeIndex] = "";
            break;
          case "content":
            // Append a text delta to the assistant message.
            setAssistant({
              content: (this.messages[activeIndex]?.content ?? "") + event.delta,
            });
            break;
          case "reasoning":
            // Append a reasoning delta, kept separate from visible content.
            this.reasoning[activeIndex] = (this.reasoning[activeIndex] ?? "") + event.delta;
            break;
          case "tool_calls":
            setAssistant({ toolCalls: event.calls });
            // Providers expect null (not "") when an assistant turn emits only
            // tool calls; empty and null render identically in the UI.
            if (!chatMessageContentToText(this.messages[activeIndex])) {
              setAssistant({ content: null });
            }
            break;
          case "tool_result":
            // Record the result and append it as a tool-role message.
            this.toolResults[event.id] = event.result;
            this.messages.push({ role: "tool", toolCallId: event.id, content: event.result });
            break;
          case "done":
            // Normal completion: show a placeholder if the model said nothing.
            if (!chatMessageContentToText(this.messages[activeIndex])) {
              setAssistant({ content: "(no response)" });
            }
            finish();
            break;
          case "abort":
            // User-stopped: keep whatever was received, placeholder if empty.
            if (!chatMessageContentToText(this.messages[activeIndex])) {
              setAssistant({ content: "(stopped)" });
            }
            finish();
            break;
          case "error":
            if (event.error instanceof SessionExpiredError) {
              auth.logout();
              this.error = event.error.message;
            } else {
              this.error = event.error instanceof Error ? event.error.message : String(event.error);
            }
            finish();
            break;
        }
      });

      // Block until the run ends, then always release the listener (runs even
      // if awaiting throws) to avoid leaking the subscription.
      try {
        await done;
      } finally {
        unsubscribe();
      }
    },
    /** Abort the in-flight run, keeping whatever was already received. */
    stop() {
      activeHandle?.stop();
    },
    clear() {
      this.messages = [];
      this.error = null;
      this.toolResults = {};
      this.reasoning = {};
    },
  },
});
