import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import OpenAI from "openai";
import type { Stream } from "openai/core/streaming";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import type { ChatMessage, ChatRequest } from "@web-agent/shared";
import { generateRequestId, logRequest, logResponse } from "./llm-logger";

// Provider config (OpenAI-compatible). DeepSeek by default per backend/.env.
// Read lazily so the server's .env loader (run at startup) is observed.
function apiKey(): string {
  return process.env.API_KEY ?? "";
}

function baseUrl(): string {
  return (process.env.BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, "");
}

/** Resolve the model, falling back to the configured default. */
export function resolveModel(model?: string): string {
  return model?.trim() || (process.env.MODEL ?? "deepseek-v4-flash");
}

/** Create an OpenAI-compatible SDK client for the configured provider. */
export function createOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: apiKey(),
    baseURL: baseUrl(),
  });
}

export function buildChatCompletionParams(
  req: ChatRequest,
  model: string,
  stream: true,
): ChatCompletionCreateParamsStreaming;
export function buildChatCompletionParams(
  req: ChatRequest,
  model: string,
  stream: false,
): ChatCompletionCreateParamsNonStreaming;
export function buildChatCompletionParams(
  req: ChatRequest,
  model: string,
  stream: boolean,
): ChatCompletionCreateParamsStreaming | ChatCompletionCreateParamsNonStreaming {
  // Forward tool-use params when the client provides them (OpenAI-compatible
  // function calling). Kept conditional so non-tool requests are unaffected.
  const toolParams =
    req.tools && req.tools.length > 0
      ? { tools: req.tools, ...(req.tool_choice ? { tool_choice: req.tool_choice } : {}) }
      : {};
  return stream
    ? {
        model,
        messages: req.messages,
        stream: true,
        ...toolParams,
      }
    : {
        model,
        messages: req.messages,
        stream: false,
        ...toolParams,
      };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatContent(value: unknown): boolean {
  return value === null || typeof value === "string" || Array.isArray(value);
}

function hasSupportedRole(role: unknown): role is ChatMessage["role"] {
  return (
    role === "developer" ||
    role === "system" ||
    role === "user" ||
    role === "assistant" ||
    role === "tool" ||
    role === "function"
  );
}

function isMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value) || !hasSupportedRole(value.role)) return false;

  if (value.role === "assistant") {
    const hasPayload =
      value.content !== undefined ||
      Array.isArray(value.tool_calls) ||
      isRecord(value.function_call);
    return hasPayload && (value.content === undefined || isChatContent(value.content));
  }

  if (value.role === "tool") {
    return typeof value.tool_call_id === "string" && isChatContent(value.content);
  }

  if (value.role === "function") {
    return typeof value.name === "string" && isChatContent(value.content);
  }

  return "content" in value && isChatContent(value.content);
}

function badRequest(c: Context, message: string) {
  return c.json({ success: false, message }, 400);
}

/**
 * Authenticated chat proxy: forwards a chat request to the configured
 * OpenAI-compatible provider and streams (or returns) the completion.
 */
export async function chatHandler(c: Context) {
  if (!apiKey()) {
    return c.json(
      {
        success: false,
        message: "Upstream API key is not configured",
      },
      503,
    );
  }

  let body: ChatRequest;
  try {
    body = (await c.req.json()) as ChatRequest;
  } catch {
    return badRequest(c, "Request body must be valid JSON");
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isMessage)) {
    return badRequest(c, "messages must be a non-empty OpenAI-compatible chat message array");
  }

  const model = resolveModel(body.model);
  const wantsStream = body.stream === true;
  const client = createOpenAIClient();
  const requestId = generateRequestId();
  const startTime = Date.now();

  // Log the incoming request from frontend
  logRequest({
    requestId,
    model,
    stream: wantsStream,
    messageCount: messages.length,
    messages,
  });

  if (wantsStream) {
    let completionStream: Stream<ChatCompletionChunk>;
    try {
      completionStream = await client.chat.completions.create(
        buildChatCompletionParams(body, model, true),
      );
    } catch (err) {
      logResponse({
        requestId,
        model,
        stream: true,
        content: "",
        durationMs: Date.now() - startTime,
        error: String(err),
      });
      return c.json({ success: false, message: "Failed to reach model provider" }, 502);
    }

    // Accumulate the full response content for logging
    let fullContent = "";

    return streamSSE(c, async (stream) => {
      try {
        for await (const chunk of completionStream) {
          if (stream.aborted) break;
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) fullContent += delta;
          await stream.writeSSE({ data: JSON.stringify(chunk) });
        }
        if (!stream.aborted) {
          await stream.writeSSE({ data: "[DONE]" });
        }
      } catch (err) {
        if (!stream.aborted) console.error("[chat] stream error:", err);
      } finally {
        completionStream.controller.abort();
        // Log the complete streamed response
        logResponse({
          requestId,
          model,
          stream: true,
          content: fullContent,
          durationMs: Date.now() - startTime,
        });
      }
    });
  }

  let completion: ChatCompletion;
  try {
    completion = await client.chat.completions.create(
      buildChatCompletionParams(body, model, false),
    );
  } catch (err) {
    logResponse({
      requestId,
      model,
      stream: false,
      content: "",
      durationMs: Date.now() - startTime,
      error: String(err),
    });
    return c.json({ success: false, message: "Failed to reach model provider" }, 502);
  }

  // Log the non-streaming response
  logResponse({
    requestId,
    model,
    stream: false,
    content: completion.choices[0]?.message?.content ?? "",
    usage: completion.usage
      ? {
          prompt_tokens: completion.usage.prompt_tokens,
          completion_tokens: completion.usage.completion_tokens,
          total_tokens: completion.usage.total_tokens,
        }
      : undefined,
    durationMs: Date.now() - startTime,
  });

  return c.json(completion);
}
