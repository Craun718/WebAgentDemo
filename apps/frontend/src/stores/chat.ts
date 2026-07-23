import { fetchEventSource } from "@microsoft/fetch-event-source";
import { defineStore } from "pinia";
import type { ChatCompletionChunk, ChatMessage } from "@web-agent/shared";
import { useAuthStore } from "./auth";

interface ChatState {
  messages: ChatMessage[];
  input: string;
  streaming: boolean;
  error: string | null;
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

// Controller for the in-flight request; lets the user stop generation.
let activeController: AbortController | null = null;

export const useChatStore = defineStore("chat", {
  state: (): ChatState => ({
    messages: [],
    input: "",
    streaming: false,
    error: null,
  }),
  actions: {
    async send() {
      const auth = useAuthStore();
      const content = this.input.trim();
      if (!auth.token || !content || this.streaming) return;

      const userMsg: ChatMessage = { role: "user", content };
      const assistantMsg: ChatMessage = { role: "assistant", content: "" };
      // Send the conversation so far, without the empty assistant placeholder.
      const payload = [...this.messages, userMsg];
      const assistantIndex = this.messages.length + 1;
      this.messages.push(userMsg, assistantMsg);
      this.input = "";
      this.streaming = true;
      this.error = null;

      const getAssistantContent = () => chatMessageContentToText(this.messages[assistantIndex]);
      const setAssistantContent = (nextContent: string) => {
        const current = this.messages[assistantIndex];
        if (!current || current.role !== "assistant") return;
        this.messages[assistantIndex] = {
          ...current,
          content: nextContent,
        };
      };

      activeController = new AbortController();
      let aborted = false;

      try {
        await fetchEventSource("/api/v1/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ messages: payload, stream: true }),
          signal: activeController.signal,
          // Keep the stream alive instead of aborting when the tab is backgrounded.
          openWhenHidden: true,
          async onopen(res) {
            if (res.status === 401) {
              auth.logout();
              throw new Error("Session expired, please sign in again");
            }
            if (!res.ok) {
              throw new Error(`Request failed (${res.status})`);
            }
          },
          onmessage(ev) {
            if (ev.data === "[DONE]") return;
            try {
              const chunk = JSON.parse(ev.data) as ChatCompletionChunk;
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                setAssistantContent(getAssistantContent() + delta);
              }
            } catch {
              // ignore non-JSON keepalive/partial frames
            }
          },
          onerror(err) {
            // Throw to stop @microsoft/fetch-event-source from auto-reconnecting
            // and propagate the error to the outer try/catch.
            throw err;
          },
        });

        aborted = activeController.signal.aborted;
      } catch (err) {
        aborted = activeController?.signal.aborted === true;
        if (!aborted) {
          this.error = err instanceof Error ? err.message : String(err);
        }
      } finally {
        // On user-initiated abort keep whatever was already streamed.
        if (aborted) {
          if (!getAssistantContent()) setAssistantContent("(stopped)");
        } else if (!this.error && !getAssistantContent()) {
          setAssistantContent("(no response)");
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
      this.messages = [];
      this.error = null;
    },
  },
});
