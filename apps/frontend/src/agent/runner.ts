import { AIMessage, AIMessageChunk, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage, MessageContent } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import type {
  Agent,
  AgentEvent,
  AgentMessage,
  AgentRunHandle,
  AgentRunInput,
  ToolCallPart,
} from "./types";
import { createBackendFetch } from "./transport";

type GraphStreamItem = [mode: "messages" | "tools", payload: unknown];

interface AgentGraph {
  stream(
    input: { messages: BaseMessage[] },
    options: { streamMode: ["messages", "tools"]; signal?: AbortSignal },
  ): Promise<AsyncIterable<GraphStreamItem>>;
}

export interface LangChainAgentOptions {
  getToken: () => string | null;
  tools: StructuredToolInterface[];
  createGraph?: (llm: ChatOpenAI, tools: StructuredToolInterface[]) => AgentGraph;
}

interface ToolCallSlot {
  id: string;
  name: string;
  arguments: string;
}

interface ModelRunAccumulator {
  key: string | null;
  reasoning: string;
  toolCalls: Map<number, ToolCallSlot>;
}

const messageMetadata = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part !== "object" || part === null) return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

function reasoningToText(message: AIMessageChunk): string {
  const reasoning = message.additional_kwargs?.reasoning_content;
  if (typeof reasoning === "string") return reasoning;
  return "";
}

function toolOutputToText(output: unknown): string {
  const content = (output as { content?: unknown } | null)?.content;
  const text = contentToText(content);
  if (text !== "") return text;
  if (typeof output === "string") return output;
  return JSON.stringify(output ?? "");
}

function errorToText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function toLangChainMessages(messages: AgentMessage[]): BaseMessage[] {
  return messages.map((message) => {
    if (message.role === "user") return new HumanMessage(message.content);
    if (message.role === "tool") {
      return new ToolMessage({ content: message.content, tool_call_id: message.toolCallId });
    }

    const toolCalls = message.toolCalls?.map((call) => ({
      id: call.id,
      name: call.name,
      args: JSON.parse(call.arguments || "{}") as Record<string, unknown>,
    }));
    return new AIMessage({
      content: (message.content ?? "") satisfies MessageContent,
      ...(message.reasoning ? { additional_kwargs: { reasoning_content: message.reasoning } } : {}),
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    });
  });
}

function createModelRunAccumulator(): ModelRunAccumulator {
  return { key: null, reasoning: "", toolCalls: new Map() };
}

function mergeToolCallChunk(acc: ModelRunAccumulator, chunk: AIMessageChunk): void {
  const chunks = chunk.tool_call_chunks ?? [];
  if (chunks.length > 0) {
    for (const call of chunks) {
      const index = call.index ?? acc.toolCalls.size;
      const slot = acc.toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
      slot.id += call.id ?? "";
      slot.name += call.name ?? "";
      slot.arguments += call.args ?? "";
      acc.toolCalls.set(index, slot);
    }
    return;
  }

  // Some providers and test models emit already-parsed tool calls in one chunk.
  for (const [index, call] of (chunk.tool_calls ?? []).entries()) {
    const slot = acc.toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
    slot.id = call.id ?? slot.id;
    slot.name = call.name;
    slot.arguments = JSON.stringify(call.args ?? {});
    acc.toolCalls.set(index, slot);
  }
}

function finalizeToolCalls(acc: ModelRunAccumulator): ToolCallPart[] {
  const calls = [...acc.toolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, slot], index) => ({
      id: slot.id || `call_${index + 1}`,
      name: slot.name,
      arguments: slot.arguments || "{}",
    }))
    .filter((call) => call.name !== "");
  acc.toolCalls.clear();
  return calls;
}

function modelRunKey(message: AIMessageChunk, metadata: Record<string, unknown>): string {
  const step = metadata.langgraph_step;
  if (step !== undefined) return String(step);
  return message.id ?? "model-run";
}

function createDefaultGraph(llm: ChatOpenAI, tools: StructuredToolInterface[]): AgentGraph {
  return createReactAgent({ llm, tools }) as AgentGraph;
}

export function createLangChainAgent({
  getToken,
  tools,
  createGraph = createDefaultGraph,
}: LangChainAgentOptions): Agent {
  return {
    run(runInput: AgentRunInput): AgentRunHandle {
      const messages = [...runInput.messages];
      const controller = new AbortController();
      const listeners = new Set<(event: AgentEvent) => void>();
      const emit = (event: AgentEvent): void => {
        for (const listener of listeners) listener(event);
      };

      const execute = async (): Promise<void> => {
        if (controller.signal.aborted) {
          emit({ type: "abort" });
          return;
        }

        const reasoningByToolCall = new Map<string, string>();
        const reasoningByContent = new Map<string, string>();
        for (const message of messages) {
          if (message.role !== "assistant" || !message.reasoning) continue;
          if (message.content !== null) reasoningByContent.set(message.content, message.reasoning);
          for (const call of message.toolCalls ?? []) {
            reasoningByToolCall.set(call.id, message.reasoning);
          }
        }

        const resolveReasoningContent = (message: Record<string, unknown>): string | undefined => {
          const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
          for (const call of toolCalls) {
            if (typeof call !== "object" || call === null) continue;
            const id = (call as { id?: unknown }).id;
            if (typeof id !== "string") continue;
            const reasoning = reasoningByToolCall.get(id);
            if (reasoning !== undefined) return reasoning;
          }
          if (typeof message.content === "string") {
            return reasoningByContent.get(message.content);
          }
          return undefined;
        };

        const llm = new ChatOpenAI({
          model: "",
          streaming: true,
          apiKey: "browser-session",
          configuration: {
            apiKey: "browser-session",
            baseURL: `${globalThis.location?.origin ?? "http://localhost"}/api/v1`,
            fetch: createBackendFetch(getToken, resolveReasoningContent),
            dangerouslyAllowBrowser: true,
          },
        });
        const graph = createGraph(llm, tools);
        const acc = createModelRunAccumulator();
        const inputMessages = toLangChainMessages(messages);

        emit({ type: "assistant_start" });
        const stream = await graph.stream(
          { messages: inputMessages },
          { streamMode: ["messages", "tools"], signal: controller.signal },
        );

        for await (const [mode, payload] of stream) {
          if (mode === "tools") {
            const event = payload as {
              event: string;
              toolCallId?: string;
              output?: unknown;
              error?: unknown;
            };
            const id = event.toolCallId ?? "";
            const calls =
              event.event === "on_tool_end" || event.event === "on_tool_error"
                ? finalizeToolCalls(acc)
                : [];
            for (const call of calls) {
              if (acc.reasoning !== "") reasoningByToolCall.set(call.id, acc.reasoning);
            }
            if (calls.length > 0) emit({ type: "tool_calls", calls });
            if (event.event === "on_tool_end" && id !== "") {
              emit({ type: "tool_result", id, result: toolOutputToText(event.output) });
            } else if (event.event === "on_tool_error" && id !== "") {
              emit({ type: "tool_result", id, result: errorToText(event.error) });
            }
            continue;
          }

          const [messageValue, metadataValue] = payload as [unknown, unknown];
          if (!AIMessageChunk.isInstance(messageValue)) continue;
          const metadata = messageMetadata(metadataValue);
          const chunk = messageValue;
          const key = modelRunKey(chunk, metadata);
          if (acc.key !== null && acc.key !== key) {
            const calls = finalizeToolCalls(acc);
            if (calls.length > 0) emit({ type: "tool_calls", calls });
            acc.reasoning = "";
            emit({ type: "assistant_start" });
          }
          acc.key = key;

          mergeToolCallChunk(acc, chunk);
          const content = contentToText(chunk.content);
          if (content !== "") emit({ type: "content", delta: content });
          const reasoning = reasoningToText(chunk);
          acc.reasoning += reasoning;
          if (reasoning !== "") emit({ type: "reasoning", delta: reasoning });
        }

        const calls = finalizeToolCalls(acc);
        if (calls.length > 0) emit({ type: "tool_calls", calls });
        emit({ type: "done" });
      };

      queueMicrotask(() => {
        execute().catch((error: unknown) => {
          if (controller.signal.aborted) {
            emit({ type: "abort" });
            return;
          }
          emit({ type: "error", error });
        });
      });

      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        stop() {
          controller.abort();
        },
      };
    },
  };
}
