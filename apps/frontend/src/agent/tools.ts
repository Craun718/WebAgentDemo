import { defineTool, Type } from "moongazer";
import type { AgentTool } from "moongazer";

/** Sample tool: returns the current time in the browser's locale/timezone. */
const getCurrentTime = defineTool({
  name: "get_current_time",
  description: "Get the current date and time in the user's locale and timezone.",
  // Use a TypeBox schema (not a plain object) so moongazer's Value.Cast can
  // dispatch on the TypeBox.Kind symbol; a bare JSON Schema object throws
  // "Unknown type" inside Value.Check.
  parameters: Type.Object({}),
  execute: () => new Date().toLocaleString(),
});

/** Registry of client-side tools available to the agent. */
export const tools: AgentTool[] = [getCurrentTime];
