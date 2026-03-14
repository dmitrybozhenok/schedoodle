import type { LanguageModel } from "ai";
import { env } from "./env.js";

let createAnthropicModel: ((modelId: string) => LanguageModel) | null = null;
let createOllamaModel: ((modelId: string) => LanguageModel) | null = null;

export const DEFAULT_MODEL =
	env.LLM_PROVIDER === "ollama" ? "gemma3:12b" : "claude-sonnet-4-20250514";

/**
 * Resolve a model instance from the configured provider.
 * Lazy-imports provider SDKs so only the active one is loaded.
 */
export async function resolveModel(modelId: string): Promise<LanguageModel> {
	const provider = env.LLM_PROVIDER;

	if (provider === "ollama") {
		if (!createOllamaModel) {
			const { ollama } = await import("ai-sdk-ollama");
			createOllamaModel = (id: string) =>
				ollama(id, { structuredOutputs: true }) as unknown as LanguageModel;
		}
		return createOllamaModel(modelId);
	}

	// Default: anthropic
	if (!createAnthropicModel) {
		const { anthropic } = await import("@ai-sdk/anthropic");
		createAnthropicModel = (id: string) => anthropic(id) as unknown as LanguageModel;
	}
	return createAnthropicModel(modelId);
}
