import { afterEach, describe, expect, it } from "vitest";
import {
    buildUpstreamBody,
    buildUpstreamHeaders,
    chatCompletionsUrl,
    resolveModel,
} from "./chat";
import type { ChatRequest } from "@web-agent/shared";

const originalEnv = { ...process.env };

afterEach(() => {
    process.env = { ...originalEnv };
});

describe("resolveModel", () => {
    it("uses the request model when provided", () => {
        expect(resolveModel("gpt-4o")).toBe("gpt-4o");
    });

    it("trims whitespace", () => {
        expect(resolveModel("  deepseek-chat  ")).toBe("deepseek-chat");
    });

    it("falls back to the MODEL env var", () => {
        process.env.MODEL = "env-model";
        expect(resolveModel(undefined)).toBe("env-model");
    });

    it("falls back to deepseek-v4-flash when nothing is configured", () => {
        delete process.env.MODEL;
        expect(resolveModel("")).toBe("deepseek-v4-flash");
    });
});

describe("chatCompletionsUrl", () => {
    it("builds the completions path from BASE_URL", () => {
        process.env.BASE_URL = "https://api.deepseek.com";
        expect(chatCompletionsUrl()).toBe(
            "https://api.deepseek.com/chat/completions",
        );
    });

    it("strips trailing slashes from BASE_URL", () => {
        process.env.BASE_URL = "https://api.deepseek.com/v1/";
        expect(chatCompletionsUrl()).toBe(
            "https://api.deepseek.com/v1/chat/completions",
        );
    });
});

describe("buildUpstreamHeaders", () => {
    it("includes the bearer API key", () => {
        process.env.API_KEY = "sk-test-key";
        const headers = buildUpstreamHeaders();
        expect(headers["Authorization"]).toBe("Bearer sk-test-key");
        expect(headers["Content-Type"]).toBe("application/json");
    });
});

describe("buildUpstreamBody", () => {
    it("serializes model, messages and the stream flag", () => {
        const req: ChatRequest = {
            messages: [{ role: "user", content: "hi" }],
            stream: true,
        };
        const parsed = JSON.parse(buildUpstreamBody(req, "deepseek-chat"));
        expect(parsed).toEqual({
            model: "deepseek-chat",
            messages: [{ role: "user", content: "hi" }],
            stream: true,
        });
    });

    it("defaults stream to false when omitted", () => {
        const req: ChatRequest = {
            messages: [{ role: "user", content: "hi" }],
        };
        const parsed = JSON.parse(buildUpstreamBody(req, "deepseek-chat"));
        expect(parsed.stream).toBe(false);
    });
});
