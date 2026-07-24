import { afterEach, describe, expect, it } from "vitest";
import { buildChatCompletionParams, createOpenAIClient, resolveModel } from "./chat";
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

describe("createOpenAIClient", () => {
  it("uses the configured OpenAI-compatible base URL", () => {
    process.env.API_KEY = "sk-test-key";
    process.env.BASE_URL = "https://api.deepseek.com/v1/";
    const client = createOpenAIClient();

    expect(client.baseURL).toBe("https://api.deepseek.com/v1");
  });
});

describe("buildChatCompletionParams", () => {
  it("builds streaming chat completions params", () => {
    const req: ChatRequest = {
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };

    expect(buildChatCompletionParams(req, "deepseek-chat", true)).toEqual({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
  });

  it("builds non-streaming chat completions params", () => {
    const req: ChatRequest = {
      messages: [{ role: "user", content: "hi" }],
    };

    expect(buildChatCompletionParams(req, "deepseek-chat", false)).toEqual({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });
  });

  it("forwards tools and tool_choice when provided", () => {
    const req: ChatRequest = {
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_time",
            description: "Get current time",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      tool_choice: "auto",
    };

    expect(buildChatCompletionParams(req, "deepseek-chat", true)).toEqual({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      tools: req.tools,
      tool_choice: "auto",
    });
  });
});
