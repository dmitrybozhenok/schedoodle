import type { Tool as AiTool } from "ai";
import type { Tool } from "../../types/index.js";
import { webFetchTool } from "./web-fetch.js";
import { webSearchTool } from "./web-search.js";
import { createWebhookTool } from "./webhook.js";

// biome-ignore lint/suspicious/noExplicitAny: AI SDK tools have heterogeneous input types
type AnyTool = AiTool<any, any>;

export function buildToolSet(customTools: Tool[] = []): Record<string, AnyTool> {
	const toolSet: Record<string, AnyTool> = {
		web_fetch: webFetchTool,
		web_search: webSearchTool,
	};

	for (const toolDef of customTools) {
		const key = `custom_${toolDef.name.toLowerCase().replace(/\s+/g, "_")}`;
		toolSet[key] = createWebhookTool(toolDef);
	}

	return toolSet;
}
