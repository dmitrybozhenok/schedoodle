/**
 * Component-level eval tests (Layer 3).
 *
 * These test individual components in isolation to identify WHERE failures occur,
 * per Chip Huyen's principle: "Evaluate all components in a system independently."
 *
 * Unlike the integration eval harness (evals/eval.ts) which tests end-to-end via API,
 * these tests import components directly and verify their contracts.
 */
import { describe, expect, it } from "vitest";
import { estimateCost, getModelPricing } from "../src/config/pricing.js";
import { agentOutputSchema } from "../src/schemas/agent-output.js";
import { buildPrompt, extractUrls } from "../src/services/prefetch.js";

// ── Prefetch Component Evals ─────────────────────────────────────

describe("Component Eval: URL Extraction", () => {
	const cases = [
		{
			name: "extracts single URL from prose",
			input: "Check the weather at https://api.weather.gov/points/39.7,-104.9 for Denver.",
			expectedCount: 1,
			expectedUrls: ["https://api.weather.gov/points/39.7,-104.9"],
		},
		{
			name: "extracts multiple URLs",
			input: "Compare https://example.com/a and https://example.com/b for differences.",
			expectedCount: 2,
		},
		{
			name: "deduplicates repeated URLs",
			input: "Visit https://example.com twice: https://example.com",
			expectedCount: 1,
		},
		{
			name: "handles no URLs gracefully",
			input: "Just a plain task with no links.",
			expectedCount: 0,
		},
		{
			name: "handles URLs with query params",
			input: "Fetch https://api.example.com/search?q=test&limit=10 for data.",
			expectedCount: 1,
		},
		{
			name: "handles URLs in parentheses",
			input: "See the docs (https://docs.example.com/guide) for details.",
			expectedCount: 1,
		},
	];

	for (const tc of cases) {
		it(tc.name, () => {
			const urls = extractUrls(tc.input);
			expect(urls).toHaveLength(tc.expectedCount);
			if (tc.expectedUrls) {
				for (const expected of tc.expectedUrls) {
					expect(urls).toContain(expected);
				}
			}
		});
	}
});

describe("Component Eval: Prompt Construction", () => {
	it("returns task description unchanged when no context data", () => {
		const task = "Summarise TDD benefits.";
		const result = buildPrompt(task, new Map());
		expect(result).toBe(task);
	});

	it("appends pre-fetched context with clear delimiters", () => {
		const task = "Analyse this page.";
		const context = new Map([["https://example.com", "Page content here"]]);
		const result = buildPrompt(task, context);
		expect(result).toContain(task);
		expect(result).toContain("Pre-fetched reference data:");
		expect(result).toContain("https://example.com");
		expect(result).toContain("Page content here");
	});

	it("includes all context entries for multiple URLs", () => {
		const task = "Compare these.";
		const context = new Map([
			["https://a.com", "Content A"],
			["https://b.com", "Content B"],
		]);
		const result = buildPrompt(task, context);
		expect(result).toContain("Content A");
		expect(result).toContain("Content B");
	});
});

// ── Schema Validation Evals ──────────────────────────────────────

describe("Component Eval: Output Schema", () => {
	const validOutputs = [
		{
			name: "minimal valid output",
			output: { summary: "Brief summary", details: "Detailed explanation" },
		},
		{
			name: "output with data field",
			output: {
				summary: "Summary",
				details: "Details",
				data: '{"key": "value"}',
			},
		},
		{
			name: "output with long content",
			output: {
				summary: "A".repeat(500),
				details: "B".repeat(5000),
			},
		},
	];

	const invalidOutputs = [
		{
			name: "missing summary",
			output: { details: "Only details" },
		},
		{
			name: "missing details",
			output: { summary: "Only summary" },
		},
		{
			name: "empty object",
			output: {},
		},
		{
			name: "wrong types",
			output: { summary: 123, details: true },
		},
	];

	for (const tc of validOutputs) {
		it(`accepts: ${tc.name}`, () => {
			const result = agentOutputSchema.safeParse(tc.output);
			expect(result.success).toBe(true);
		});
	}

	for (const tc of invalidOutputs) {
		it(`rejects: ${tc.name}`, () => {
			const result = agentOutputSchema.safeParse(tc.output);
			expect(result.success).toBe(false);
		});
	}
});

// ── Pricing Eval ─────────────────────────────────────────────────

describe("Component Eval: Cost Estimation", () => {
	it("returns zero cost for local models", () => {
		const localModels = ["gemma3:4b", "qwen2.5:7b", "llama3:8b", "phi3:mini", "mistral:7b"];
		for (const model of localModels) {
			const cost = estimateCost(model, 1000, 500);
			expect(cost).toBe(0);
		}
	});

	it("returns correct cost for Claude Sonnet", () => {
		const cost = estimateCost("claude-sonnet-4-20250514", 1_000_000, 1_000_000);
		// $3/MTok input + $15/MTok output = $18
		expect(cost).toBe(18);
	});

	it("uses default pricing for unknown models", () => {
		const pricing = getModelPricing("unknown-model-xyz");
		expect(pricing.inputPerMTok).toBe(3);
		expect(pricing.outputPerMTok).toBe(15);
	});

	it("cost scales linearly with token count", () => {
		const cost1 = estimateCost("claude-sonnet-4-20250514", 100, 50);
		const cost10 = estimateCost("claude-sonnet-4-20250514", 1000, 500);
		expect(cost10).toBeCloseTo(cost1 * 10, 6);
	});
});
