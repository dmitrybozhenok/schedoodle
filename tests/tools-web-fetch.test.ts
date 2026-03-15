import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Stub the env module before importing the tool
vi.mock("../src/config/env.js", () => ({
	env: {
		DATABASE_URL: "./data/schedoodle.db",
		LLM_PROVIDER: "anthropic",
		ANTHROPIC_API_KEY: "test-key",
		OLLAMA_BASE_URL: "http://127.0.0.1:11434/api",
		PORT: 3000,
	},
}));

import { webFetchTool } from "../src/services/tools/web-fetch.js";

describe("webFetchTool", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("is an AI SDK tool with description and execute", () => {
		expect(webFetchTool).toBeDefined();
		expect(webFetchTool.description).toContain("Fetch");
		expect(webFetchTool.execute).toBeTypeOf("function");
	});

	it("converts HTML response to plain text using html-to-text with wordwrap 120", async () => {
		const htmlContent = "<html><body><h1>Hello World</h1><p>This is a paragraph with some text.</p></body></html>";

		globalThis.fetch = vi.fn().mockResolvedValue({
			headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
			text: vi.fn().mockResolvedValue(htmlContent),
		});

		const result = await webFetchTool.execute!(
			{ url: "https://example.com/page" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		expect(result).toContain("Hello World");
		expect(result).toContain("This is a paragraph");
		// Should NOT contain HTML tags
		expect(result).not.toContain("<h1>");
		expect(result).not.toContain("<p>");
	});

	it("returns raw text for JSON responses", async () => {
		const jsonContent = '{"key": "value", "number": 42}';

		globalThis.fetch = vi.fn().mockResolvedValue({
			headers: new Headers({ "content-type": "application/json" }),
			text: vi.fn().mockResolvedValue(jsonContent),
		});

		const result = await webFetchTool.execute!(
			{ url: "https://api.example.com/data" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		expect(result).toBe(jsonContent);
	});

	it("returns failure message on network error (does not throw)", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network unreachable"));

		const result = await webFetchTool.execute!(
			{ url: "https://unreachable.example.com" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		expect(result).toContain("[Failed to fetch");
		expect(result).toContain("https://unreachable.example.com");
		expect(result).toContain("Network unreachable");
	});

	it("returns failure message on abort signal (does not throw)", async () => {
		const controller = new AbortController();
		controller.abort();

		globalThis.fetch = vi.fn().mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

		const result = await webFetchTool.execute!(
			{ url: "https://slow.example.com" },
			{ abortSignal: controller.signal, toolCallId: "test", messages: [] },
		);

		expect(result).toContain("[Failed to fetch");
		expect(result).toContain("https://slow.example.com");
	});

	it("sends User-Agent header", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			headers: new Headers({ "content-type": "text/plain" }),
			text: vi.fn().mockResolvedValue("plain text"),
		});

		await webFetchTool.execute!(
			{ url: "https://example.com" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
		expect(fetchCall[1]?.headers).toMatchObject({ "User-Agent": "Schedoodle/1.0" });
	});
});
