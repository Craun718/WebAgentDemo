import type { AgentTool } from "moongazer";
import { Type } from "moongazer";

/** Returns the current time in a given IANA timezone. */
const getCurrentTime: AgentTool = {
  name: "get_current_time",
  description:
    "Get the current date and time in the user's locale. " +
    "Provide `timeZone` as an IANA identifier (e.g. 'Asia/Shanghai', 'America/New_York').",
  // Use a TypeBox schema (not a plain object) so moongazer's Value.Cast can
  // dispatch on the TypeBox.Kind symbol; a bare JSON Schema object throws
  // "Unknown type" inside Value.Check.
  parameters: Type.Object({
    // IANA timezone identifier required.
    timeZone: Type.String(),
  }),
  // An invalid timeZone is reported back to the model instead of silently
  // falling back, so the model can retry with a correct IANA identifier.
  execute: ({ timeZone }) => {
    if (typeof timeZone !== "string" || timeZone.trim() === "") {
      return `Invalid timeZone parameter: ${JSON.stringify(timeZone)}. Provide an IANA timezone identifier such as 'Asia/Shanghai' or 'America/New_York'.`;
    }
    try {
      return new Date().toLocaleString(undefined, { timeZone });
    } catch {
      return `Invalid timeZone parameter: "${timeZone}". Provide a valid IANA timezone identifier such as 'Asia/Shanghai' or 'America/New_York'.`;
    }
  },
};

/** Registry of client-side tools available to the agent. */
export const tools: AgentTool[] = [getCurrentTime];
