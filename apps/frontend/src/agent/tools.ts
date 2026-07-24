import type { AgentTool } from "moongazer";

/** Sample tool: returns the current time in the browser's locale/timezone. */
const getCurrentTime: AgentTool = {
  name: "get_current_time",
  description: "Get the current date and time in the user's locale and timezone.",
  parameters: { type: "object", properties: {}, required: [] },
  execute: () => new Date().toLocaleString(),
};

/** Registry of client-side tools available to the agent. */
export const tools: AgentTool[] = [getCurrentTime];
