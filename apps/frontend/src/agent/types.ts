export interface ToolCallPart {
  id: string;
  name: string;
  arguments: string;
}

export interface UserMessage {
  role: "user";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  /** Provider thinking text that must be replayed for thinking-mode tool loops. */
  reasoning?: string;
  toolCalls?: ToolCallPart[];
}

export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  content: string;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

export type AgentEvent =
  | { type: "assistant_start" }
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_calls"; calls: ToolCallPart[] }
  | { type: "tool_result"; id: string; result: string }
  | { type: "done" }
  | { type: "abort" }
  | { type: "error"; error: unknown };

export interface AgentRunInput {
  messages: AgentMessage[];
}

export interface AgentRunHandle {
  subscribe(listener: (event: AgentEvent) => void): () => void;
  stop(): void;
}

export interface Agent {
  run(input: AgentRunInput): AgentRunHandle;
}
