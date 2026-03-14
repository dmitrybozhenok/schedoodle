export interface ModelPricing {
	inputPerMTok: number;
	outputPerMTok: number;
}

const LOCAL_MODEL_PRICING: ModelPricing = { inputPerMTok: 0, outputPerMTok: 0 };

const MODEL_PRICING: Record<string, ModelPricing> = {
	"claude-sonnet-4-20250514": { inputPerMTok: 3, outputPerMTok: 15 },
	"claude-sonnet-4.5-20250514": { inputPerMTok: 3, outputPerMTok: 15 },
	"claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
	"claude-haiku-4.5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
	"claude-opus-4.5-20250514": { inputPerMTok: 5, outputPerMTok: 25 },
};

const LOCAL_MODEL_PREFIXES = ["gemma", "qwen", "llama", "phi", "mistral", "deepseek"];

const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 3, outputPerMTok: 15 };

export function getModelPricing(modelId: string): ModelPricing {
	if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId];
	if (LOCAL_MODEL_PREFIXES.some((p) => modelId.toLowerCase().startsWith(p))) {
		return LOCAL_MODEL_PRICING;
	}
	return DEFAULT_PRICING;
}

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
	const pricing = getModelPricing(modelId);
	const cost =
		(inputTokens / 1_000_000) * pricing.inputPerMTok +
		(outputTokens / 1_000_000) * pricing.outputPerMTok;
	return Math.round(cost * 1_000_000) / 1_000_000;
}
