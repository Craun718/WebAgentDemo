import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ChatCompletionContentPartText } from "openai/resources/chat/completions";
import type { ChatMessage } from "@web-agent/shared";

const LOG_DIR = join(process.cwd(), "logs");

let dirReady: Promise<void> | undefined;

function ensureLogDir(): Promise<void> {
    if (!dirReady)
        dirReady = mkdir(LOG_DIR, { recursive: true }).then(() => {});
    return dirReady;
}

function logFilePath(): string {
    const date = new Date().toISOString().slice(0, 10);
    return join(LOG_DIR, `llm-${date}.log.jsonl`);
}

function generateRequestId(): string {
    return Math.random().toString(16).slice(2, 10);
}

// --- Log entry types ---

export interface LoggedToolCall {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
}

interface LlmRequestLog {
    timestamp: string;
    direction: "request";
    requestId: string;
    model: string;
    stream: boolean;
    messageCount: number;
    messages: ChatMessage[];
}

interface LlmResponseLog {
    timestamp: string;
    direction: "response";
    requestId: string;
    model: string;
    stream: boolean;
    content: string;
    toolCalls?: LoggedToolCall[];
    finishReason?: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    durationMs: number;
    error?: string;
}

type LlmLogEntry = LlmRequestLog | LlmResponseLog;

// --- Core write ---

async function writeLog(entry: LlmLogEntry) {
    try {
        await ensureLogDir();
        const line = JSON.stringify(entry) + "\n";
        await appendFile(logFilePath(), line, "utf-8");
    } catch {
        // ignore write errors
    }
}

function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + "…" : text;
}

/** Type guard: narrows to ChatCompletionContentPartText */
function isTextPart(part: unknown): part is ChatCompletionContentPartText {
    return (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: string }).type === "text"
    );
}

/** Extract readable text from a single message. */
function messagePreview(m: ChatMessage): string {
    const role = m.role;
    const c = m.content;

    let text = "";
    if (typeof c === "string") {
        text = c;
    } else if (Array.isArray(c)) {
        for (const part of c) {
            if (isTextPart(part)) {
                text += part.text;
            }
        }
    }

    return `[${role}] ${truncate(text.replace(/\n/g, " "), 60)}`;
}

function logToConsole(entry: LlmLogEntry) {
    if (entry.direction === "request") {
        const previews = entry.messages.map(messagePreview);
        console.log(
            `[LLM→REQ] #${entry.requestId} | model=${entry.model} | stream=${entry.stream} | msgs=${entry.messageCount}`,
        );
        for (const p of previews) {
            console.log(`  ${p}`);
        }
    } else {
        const snippet = truncate(entry.content.replace(/\n/g, " "), 80);
        const usageStr = entry.usage
            ? ` | tokens=${entry.usage.total_tokens}`
            : "";
        const reasonStr = entry.finishReason
            ? ` | reason=${entry.finishReason}`
            : "";
        const toolStr = entry.toolCalls?.length
            ? ` | tools=${entry.toolCalls.map((t) => `${t.function.name}(${truncate(t.function.arguments.replace(/\n/g, " "), 40)})`).join(", ")}`
            : "";
        console.log(
            `[LLM←RES] #${entry.requestId} | ${entry.durationMs}ms${usageStr}${reasonStr}${toolStr} | "${snippet}"`,
        );
    }
}

// --- Public API ---

export function logRequest(
    entry: Omit<LlmRequestLog, "timestamp" | "direction">,
) {
    const full: LlmRequestLog = {
        ...entry,
        timestamp: new Date().toISOString(),
        direction: "request",
    };
    logToConsole(full);
    writeLog(full);
}

export function logResponse(
    entry: Omit<LlmResponseLog, "timestamp" | "direction">,
) {
    const full: LlmResponseLog = {
        ...entry,
        timestamp: new Date().toISOString(),
        direction: "response",
    };
    logToConsole(full);
    writeLog(full);
}

export { generateRequestId };
