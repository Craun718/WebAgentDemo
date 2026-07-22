// Shared domain types consumed by both backend and frontend via workspace symlink.

export interface HealthResponse {
  status: "ok";
  service: string;
  time: string;
}

export const SERVICE_NAME = "web-agent";

export function buildHealthResponse(service: string): HealthResponse {
  return { status: "ok", service, time: new Date().toISOString() };
}

// --- Login ---

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginSuccess {
  success: true;
  token: string;
}

export interface LoginFailure {
  success: false;
  message: string;
}

export type LoginResponse = LoginSuccess | LoginFailure;

// --- Now ---

export interface NowResponse {
  time: string;
}

// --- Chat ---

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  stream?: boolean;
  model?: string;
}

// OpenAI-compatible (DeepSeek) streaming chunk the proxy forwards as SSE.
export interface ChatCompletionChunkChoice {
  index: number;
  delta: { role?: ChatRole; content?: string };
  finish_reason: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  model: string;
  choices: ChatCompletionChunkChoice[];
}
