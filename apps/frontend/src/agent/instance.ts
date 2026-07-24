import { createAgent, createOpenAITransport } from "moongazer";
import { useAuthStore } from "../stores/auth";
import { createRawStream } from "./transport";
import { tools } from "./tools";

/**
 * The application's single agent instance: an OpenAI-compatible transport
 * pointed at the backend SSE proxy, plus the client-side tool registry.
 */
export const agent = createAgent({
  transport: createOpenAITransport(createRawStream(() => useAuthStore().token)),
  tools,
});
