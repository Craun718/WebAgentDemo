import { describe, expect, it } from "vitest";
import { AIMessageChunk, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";
import { createLangChainAgent } from "./runner";
import type { Agent, AgentEvent } from "./types";

function trackEvents(handle: ReturnType<Agent["run"]>): {
  events: AgentEvent[];
  finished: Promise<void>;
} {
  const events: AgentEvent[] = [];
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  handle.subscribe((event) => {
    events.push(event);
    if (event.type === "done" || event.type === "abort" || event.type === "error") {
      resolveFinished();
    }
  });
  return { events, finished };
}

describe("createLangChainAgent", () => {
  it("streams model text, reasoning, tool calls, tool results, and follow-up text", async () => {
    let graphMessages: BaseMessage[] | undefined;
    const agent = createLangChainAgent({
      getToken: () => "token",
      tools: [],
      createGraph: (_llm: ChatOpenAI) => ({
        async stream(input, options) {
          graphMessages = input.messages;
          expect(options.streamMode).toEqual(["messages", "tools"]);
          return (async function* () {
            yield [
              "messages",
              [
                new AIMessageChunk({
                  content: "Let me check.",
                  additional_kwargs: { reasoning_content: "checking" },
                }),
                { langgraph_step: 1 },
              ],
            ];
            yield [
              "messages",
              [
                new AIMessageChunk({
                  tool_call_chunks: [
                    { id: "call_", name: "fly_", args: '{"longitude":116', index: 0 },
                  ],
                }),
                { langgraph_step: 1 },
              ],
            ];
            yield [
              "messages",
              [
                new AIMessageChunk({
                  tool_call_chunks: [{ id: "1", name: "to", args: ',"latitude":39.9}', index: 0 }],
                }),
                { langgraph_step: 1 },
              ],
            ];
            yield [
              "tools",
              {
                event: "on_tool_end",
                toolCallId: "call_1",
                output: new ToolMessage({
                  content: "Flying to 39.9N, 116.4E at 20000m.",
                  tool_call_id: "call_1",
                }),
              },
            ];
            yield ["messages", [new AIMessageChunk({ content: "Done." }), { langgraph_step: 2 }]];
          })();
        },
      }),
    });

    const handle = agent.run({ messages: [{ role: "user", content: "Fly there" }] });
    const { events, finished } = trackEvents(handle);
    await finished;

    expect(graphMessages).toHaveLength(1);
    expect(graphMessages?.[0]).toBeInstanceOf(HumanMessage);
    expect(events).toEqual([
      { type: "assistant_start" },
      { type: "content", delta: "Let me check." },
      { type: "reasoning", delta: "checking" },
      {
        type: "tool_calls",
        calls: [{ id: "call_1", name: "fly_to", arguments: '{"longitude":116,"latitude":39.9}' }],
      },
      { type: "tool_result", id: "call_1", result: "Flying to 39.9N, 116.4E at 20000m." },
      { type: "assistant_start" },
      { type: "content", delta: "Done." },
      { type: "done" },
    ]);
  });

  it("reports an abort when LangGraph stops because the run was aborted", async () => {
    const agent = createLangChainAgent({
      getToken: () => "token",
      tools: [],
      createGraph: () => ({
        async stream(_input, options) {
          return (async function* () {
            yield ["messages", [new AIMessageChunk({ content: "Partial" }), { langgraph_step: 1 }]];
            await Promise.resolve();
            if (options.signal?.aborted) {
              const error = new Error("Aborted");
              error.name = "AbortError";
              throw error;
            }
          })();
        },
      }),
    });

    const handle = agent.run({ messages: [{ role: "user", content: "stop" }] });
    const { events, finished } = trackEvents(handle);
    const unsubscribe = handle.subscribe((event) => {
      if (event.type === "content") {
        unsubscribe();
        handle.stop();
      }
    });
    await finished;
    expect(events).toEqual([
      { type: "assistant_start" },
      { type: "content", delta: "Partial" },
      { type: "abort" },
    ]);
  });

  it("captures model input before live UI state can append an assistant turn", async () => {
    let graphMessages: BaseMessage[] | undefined;
    const agent = createLangChainAgent({
      getToken: () => "token",
      tools: [],
      createGraph: () => ({
        async stream(input) {
          graphMessages = [...input.messages];
          return (async function* () {
            yield ["messages", [new AIMessageChunk({ content: "Done." }), { langgraph_step: 1 }]];
          })();
        },
      }),
    });

    const liveMessages: Parameters<Agent["run"]>[0]["messages"] = [
      { role: "user", content: "Fly there" },
    ];
    const handle = agent.run({ messages: liveMessages });
    const { finished } = trackEvents(handle);
    liveMessages.push({ role: "assistant", content: "" });
    await finished;

    expect(graphMessages).toHaveLength(1);
    expect(graphMessages?.[0]).toBeInstanceOf(HumanMessage);
  });

  it("reports graph errors", async () => {
    const failure = new Error("provider failed");
    const agent = createLangChainAgent({
      getToken: () => "token",
      tools: [],
      createGraph: () => ({
        async stream() {
          throw failure;
        },
      }),
    });

    const handle = agent.run({ messages: [{ role: "user", content: "hello" }] });
    const { events, finished } = trackEvents(handle);
    await finished;
    expect(events).toEqual([{ type: "assistant_start" }, { type: "error", error: failure }]);
  });
});
