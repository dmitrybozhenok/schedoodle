import type { Tool as AiTool } from "ai";
import { jsonSchema } from "ai";
import type { Tool } from "../../types/index.js";

export function createWebhookTool(toolDef: Tool): AiTool<Record<string, unknown>, string> {
	const parsedHeaders = toolDef.headers != null ? (toolDef.headers as Record<string, string>) : {};

	return {
		description: toolDef.description,
		inputSchema: jsonSchema(toolDef.inputSchema as Record<string, unknown>),
		execute: async (input: Record<string, unknown>, { abortSignal }) => {
			try {
				const signals = [AbortSignal.timeout(10_000)];
				if (abortSignal) signals.push(abortSignal);
				const combinedSignal = AbortSignal.any(signals);
				const isGet = toolDef.method === "GET";
				const response = await fetch(toolDef.url, {
					method: toolDef.method,
					headers: {
						"Content-Type": "application/json",
						...parsedHeaders,
					},
					body: isGet ? undefined : JSON.stringify(input),
					signal: combinedSignal,
				});
				return await response.text();
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return `[Webhook ${toolDef.name} failed: ${msg}]`;
			}
		},
	};
}
