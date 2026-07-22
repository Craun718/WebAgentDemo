import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChatMessage, ChatRequest } from "@web-agent/shared";

// Provider config (OpenAI-compatible). DeepSeek by default per backend/.env.
// Read lazily so the server's .env loader (run at startup) is observed.
function apiKey(): string {
    return process.env.API_KEY ?? "";
}

function baseUrl(): string {
    return (process.env.BASE_URL ?? "https://api.deepseek.com").replace(
        /\/+$/,
        "",
    );
}

/** Resolve the model, falling back to the configured default. */
export function resolveModel(model?: string): string {
    return model?.trim() || (process.env.MODEL ?? "deepseek-v4-flash");
}

/** Upstream completions URL, e.g. https://api.deepseek.com/chat/completions. */
export function chatCompletionsUrl(): string {
    return `${baseUrl()}/chat/completions`;
}

/** Headers sent to the upstream provider, including the secret API key. */
export function buildUpstreamHeaders(): Record<string, string> {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
    };
}

/** Build the OpenAI-compatible request body forwarded upstream. */
export function buildUpstreamBody(req: ChatRequest, model: string): string {
    return JSON.stringify({
        model,
        messages: req.messages,
        stream: req.stream ?? false,
    });
}

function isMessage(value: unknown): value is ChatMessage {
    if (typeof value !== "object" || value === null) return false;
    const { role, content } = value as Record<string, unknown>;
    return (
        (role === "system" || role === "user" || role === "assistant") &&
        typeof content === "string"
    );
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
    if (
        !Array.isArray(messages) ||
        messages.length === 0 ||
        !messages.every(isMessage)
    ) {
        return badRequest(
            c,
            "messages must be a non-empty array of { role, content }",
        );
    }

    const model = resolveModel(body.model);
    const wantsStream = body.stream === true;

    let upstream: Response;
    try {
        upstream = await fetch(chatCompletionsUrl(), {
            method: "POST",
            headers: buildUpstreamHeaders(),
            body: buildUpstreamBody({ ...body, stream: wantsStream }, model),
        });
    } catch (err) {
        console.error("[chat] upstream fetch failed:", err);
        return c.json(
            { success: false, message: "Failed to reach model provider" },
            502,
        );
    }

    if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => "");
        console.error(
            `[chat] upstream error ${upstream.status}:`,
            detail.slice(0, 500),
        );
        return c.json(
            {
                success: false,
                message: `Model provider returned ${upstream.status}`,
            },
            upstream.status === 429 ? 429 : 502,
        );
    }

    if (wantsStream) {
        return streamSSE(c, async (stream) => {
            const reader = upstream.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            try {
                while (!stream.aborted) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    // SSE events are separated by a blank line.
                    const events = buffer.split("\n\n");
                    buffer = events.pop() ?? "";
                    for (const event of events) {
                        for (const line of event.split("\n")) {
                            if (!line.startsWith("data:")) continue;
                            await stream.writeSSE({
                                data: line.slice(5).trimStart(),
                            });
                        }
                    }
                }
                // Flush any trailing event left in the buffer.
                for (const line of buffer.split("\n")) {
                    if (line.startsWith("data:")) {
                        await stream.writeSSE({
                            data: line.slice(5).trimStart(),
                        });
                    }
                }
            } catch (err) {
                if (!stream.aborted) console.error("[chat] stream error:", err);
            } finally {
                await reader.cancel().catch(() => {});
            }
        });
    }

    // Non-streaming: forward the JSON body verbatim.
    const text = await upstream.text();
    return c.body(text, 200, {
        "content-type":
            upstream.headers.get("content-type") ?? "application/json",
    });
}
