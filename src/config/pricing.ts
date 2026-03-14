export interface ModelPricing {
	inputPerMTok: number;
	outputPerMTok: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
	"claude-sonnet-4-20250514": { inputPerMTok: 3, outputPerMTok: 15 },
	"claude-sonnet-4.5-20250514": { inputPerMTok: 3, outputPerMTok: 15 },
	"claude-haiku-4.5-20250514": { inputPerMTok: 1, outputPerMTok: 5 },
	"claude-opus-4.5-20250514": { inputPerMTok: 5, outputPerMTok: 25 },
};

const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 3, outputPerMTok: 15 };

export function getModelPricing(modelId: string): ModelPricing {
	return MODEL_PRICING[modelId] ?? DEFAULT_PRICING;
}

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
	const pricing = getModelPricing(modelId);
	const cost =
		(inputTokens / 1_000_000) * pricing.inputPerMTok +
		(outputTokens / 1_000_000) * pricing.outputPerMTok;
	return Math.round(cost * 1_000_000) / 1_000_000;
}
