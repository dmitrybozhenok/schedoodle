import { describe, expect, it, vi, afterEach } from "vitest";

// Mock env module -- start with BRAVE_API_KEY configured
const mockEnv: Record<string, string | undefined> = {
	DATABASE_URL: "./data/schedoodle.db",
	LLM_PROVIDER: "anthropic",
	ANTHROPIC_API_KEY: "test-key",
	OLLAMA_BASE_URL: "http://127.0.0.1:11434/api",
	PORT: "3000",
	BRAVE_API_KEY: "test-brave-key",
};

vi.mock("../src/config/env.js", () => ({
	env: new Proxy(mockEnv, {
		get: (target, prop: string) => target[prop],
	}),
}));

import { webSearchTool } from "../src/services/tools/web-search.js";

describe("webSearchTool", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
		// Reset BRAVE_API_KEY for next test
		mockEnv.BRAVE_API_KEY = "test-brave-key";
	});

	it("is an AI SDK tool with description and execute", () => {
		expect(webSearchTool).toBeDefined();
		expect(webSearchTool.description).toContain("Search");
		expect(webSearchTool.execute).toBeTypeOf("function");
	});

	it("returns formatted results with title, url, description separated by double newlines", async () => {
		const braveResponse = {
			web: {
				results: [
					{ title: "Result One", url: "https://one.example.com", description: "First result description" },
					{ title: "Result Two", url: "https://two.example.com", description: "Second result description" },
				],
			},
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue(braveResponse),
		});

		const result = await webSearchTool.execute!(
			{ query: "test query" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		expect(result).toContain("Result One");
		expect(result).toContain("https://one.example.com");
		expect(result).toContain("First result description");
		expect(result).toContain("Result Two");
		// Results separated by double newlines
		expect(result).toContain("\n\n");
		// Each result has title\nurl\ndescription
		expect(result).toMatch(/Result One\nhttps:\/\/one\.example\.com\nFirst result description/);
	});

	it("returns unavailable message when BRAVE_API_KEY is not configured", async () => {
		mockEnv.BRAVE_API_KEY = undefined;

		const result = await webSearchTool.execute!(
			{ query: "test query" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		expect(result).toBe("[Web search unavailable: BRAVE_API_KEY not configured]");
	});

	it("returns HTTP error message on non-OK response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 429,
		});

		const result = await webSearchTool.execute!(
			{ query: "rate limited query" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		expect(result).toBe("[Search failed: HTTP 429]");
	});

	it("returns error message on network error (does not throw)", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("DNS resolution failed"));

		const result = await webSearchTool.execute!(
			{ query: "broken query" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		expect(result).toContain("[Search failed:");
		expect(result).toContain("DNS resolution failed");
	});

	it("sends correct headers to Brave API", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ web: { results: [] } }),
		});

		await webSearchTool.execute!(
			{ query: "test", count: 3 },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
		const url = fetchCall[0] as string;
		const options = fetchCall[1];

		expect(url).toContain("https://api.search.brave.com/res/v1/web/search");
		expect(url).toContain("q=test");
		expect(url).toContain("count=3");
		expect(options?.headers).toMatchObject({
			Accept: "application/json",
			"X-Subscription-Token": "test-brave-key",
		});
	});

	it("handles empty results array", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ web: { results: [] } }),
		});

		const result = await webSearchTool.execute!(
			{ query: "no results" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		expect(result).toBe("");
	});

	it("handles missing web.results in response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({}),
		});

		const result = await webSearchTool.execute!(
			{ query: "empty response" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		expect(result).toBe("");
	});
});
