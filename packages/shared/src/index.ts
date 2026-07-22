// Shared domain types consumed by both backend and frontend via workspace symlink.

import type {
  ChatCompletionChunk as OpenAIChatCompletionChunk,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

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

export type ChatMessage = ChatCompletionMessageParam;
export type ChatCompletionChunk = OpenAIChatCompletionChunk;

export interface ChatRequest {
  messages: ChatMessage[];
  stream?: boolean;
  model?: string;
}
