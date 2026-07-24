import type { ChatTool } from "@web-agent/shared";

/**
 * A client-side tool the model can call. `parameters` is the JSON Schema sent
 * to the model; `execute` runs in the browser and returns a JSON string that
 * gets fed back as the tool result message.
 */
export interface ClientTool<TArgs extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: TArgs) => Promise<unknown> | unknown;
}

/** Sample tool: returns the current time in the browser's locale/timezone. */
const getCurrentTime: ClientTool = {
  name: "get_current_time",
  description: "Get the current date and time in the user's locale and timezone.",
  parameters: { type: "object", properties: {}, required: [] },
  execute: () => new Date().toLocaleString(),
};

/** Registry of tools available to the model. Extend this list as needed. */
const registry: ClientTool[] = [getCurrentTime];

const byName = new Map(registry.map((t) => [t.name, t] as const));

export function getTool(name: string): ClientTool | undefined {
  return byName.get(name);
}

/** Convert the registry into the OpenAI-compatible `tools` array for the API. */
export function toApiTools(): ChatTool[] {
  return registry.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
