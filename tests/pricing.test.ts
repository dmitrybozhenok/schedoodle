import { describe, expect, it } from "vitest";
import { estimateCost, getModelPricing } from "../src/config/pricing.js";

describe("getModelPricing", () => {
	it("returns correct pricing for claude-sonnet-4-20250514", () => {
		const pricing = getModelPricing("claude-sonnet-4-20250514");
		expect(pricing.inputPerMTok).toBe(3);
		expect(pricing.outputPerMTok).toBe(15);
	});

	it("returns correct pricing for claude-haiku-4.5-20251001", () => {
		const pricing = getModelPricing("claude-haiku-4.5-20251001");
		expect(pricing.inputPerMTok).toBe(1);
		expect(pricing.outputPerMTok).toBe(5);
	});

	it("returns correct pricing for claude-opus-4.5-20250514", () => {
		const pricing = getModelPricing("claude-opus-4.5-20250514");
		expect(pricing.inputPerMTok).toBe(5);
		expect(pricing.outputPerMTok).toBe(25);
	});

	it("falls back to default pricing (Sonnet 4 rates) for unknown models", () => {
		const pricing = getModelPricing("unknown-model-123");
		expect(pricing.inputPerMTok).toBe(3);
		expect(pricing.outputPerMTok).toBe(15);
	});

	it("returns zero pricing for local Gemma models", () => {
		const pricing = getModelPricing("gemma3:12b");
		expect(pricing.inputPerMTok).toBe(0);
		expect(pricing.outputPerMTok).toBe(0);
	});

	it("returns zero pricing for local Qwen models", () => {
		const pricing = getModelPricing("qwen3:8b");
		expect(pricing.inputPerMTok).toBe(0);
		expect(pricing.outputPerMTok).toBe(0);
	});

	it("returns zero pricing for local Llama models", () => {
		const pricing = getModelPricing("llama3.2:3b");
		expect(pricing.inputPerMTok).toBe(0);
		expect(pricing.outputPerMTok).toBe(0);
	});
});

describe("estimateCost", () => {
	it("computes correct cost for claude-sonnet-4-20250514 (1000 in, 500 out)", () => {
		// 1000/1e6 * 3 + 500/1e6 * 15 = 0.003 + 0.0075 = 0.0105
		const cost = estimateCost("claude-sonnet-4-20250514", 1000, 500);
		expect(cost).toBeCloseTo(0.0105, 6);
	});

	it("returns 0 for 0 tokens", () => {
		const cost = estimateCost("claude-sonnet-4-20250514", 0, 0);
		expect(cost).toBe(0);
	});

	it("uses fallback pricing for unknown model without crashing", () => {
		const cost = estimateCost("some-future-model", 1000, 500);
		// Same as Sonnet 4 fallback
		expect(cost).toBeCloseTo(0.0105, 6);
	});

	it("returns 0 cost for local models", () => {
		const cost = estimateCost("gemma3:12b", 10000, 5000);
		expect(cost).toBe(0);
	});

	it("rounds result to 6 decimal places", () => {
		// 7 input tokens at $3/MTok = 0.000021, 3 output at $15/MTok = 0.000045 => 0.000066
		const cost = estimateCost("claude-sonnet-4-20250514", 7, 3);
		const decimalPlaces = cost.toString().split(".")[1]?.length ?? 0;
		expect(decimalPlaces).toBeLessThanOrEqual(6);
	});
});
