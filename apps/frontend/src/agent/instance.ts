import { useAuthStore } from "../stores/auth";
import { createLangChainAgent } from "./runner";
import { tools } from "./tools";

/** The app agent: LangGraph drives the loop while Cesium tools run in-page. */
export const agent = createLangChainAgent({
  getToken: () => useAuthStore().token,
  tools,
});
