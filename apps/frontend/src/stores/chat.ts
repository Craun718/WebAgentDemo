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
  }),
  actions: {
    async send() {
      const auth = useAuthStore();
      const content = this.input.trim();
      if (!auth.token || !content || this.streaming) return;

      // `this.messages` is the single source of truth for both the UI and the
      // agent conversation. The agent reads a snapshot of it as the initial
      // context and emits events that we mirror back here, so a later send
      // rebuilds a valid history including tool results.
      this.messages.push({ role: "user", content });
      this.input = "";
      this.streaming = true;
      this.error = null;

      let activeIndex = -1;
      const setAssistant = (patch: Partial<AgentMessage>): void => {
        const current = this.messages[activeIndex];
        if (!current || current.role !== "assistant") return;
        this.messages[activeIndex] = { ...current, ...patch };
      };

      activeHandle = agent.run({ messages: this.messages });

      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        activeHandle = null;
        this.streaming = false;
        resolveDone();
      };

      const off = activeHandle.subscribe((event: AgentEvent) => {
        switch (event.type) {
          case "assistant_start":
            this.messages.push({ role: "assistant", content: "" });
            activeIndex = this.messages.length - 1;
            break;
          case "content":
            setAssistant({
              content: (this.messages[activeIndex]?.content ?? "") + event.delta,
            });
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
            this.toolResults[event.id] = event.result;
            this.messages.push({ role: "tool", toolCallId: event.id, content: event.result });
            break;
          case "done":
            if (!chatMessageContentToText(this.messages[activeIndex])) {
              setAssistant({ content: "(no response)" });
            }
            finish();
            break;
          case "abort":
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

      try {
        await done;
      } finally {
        off();
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
    },
  },
});
