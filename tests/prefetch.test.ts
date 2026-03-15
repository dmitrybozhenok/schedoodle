import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrompt, extractUrls, prefetchUrls } from "../src/services/prefetch.js";

vi.mock("html-to-text", () => ({
	convert: vi.fn((html: string) => `plain: ${html}`),
}));

describe("extractUrls", () => {
	it("finds HTTP and HTTPS URLs in prose text", () => {
		const text = "Check http://example.com and https://api.example.com/data for info.";
		const urls = extractUrls(text);
		expect(urls).toContain("http://example.com");
		expect(urls).toContain("https://api.example.com/data");
		expect(urls).toHaveLength(2);
	});

	it("returns empty array when no URLs present", () => {
		const urls = extractUrls("No links here, just plain text.");
		expect(urls).toEqual([]);
	});

	it("deduplicates repeated URLs", () => {
		const text = "Visit https://example.com and https://example.com again.";
		const urls = extractUrls(text);
		expect(urls).toEqual(["https://example.com"]);
	});
});

describe("prefetchUrls", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("fetches URL and returns content", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response("Hello world", {
				headers: { "content-type": "text/plain" },
			}),
		);

		const results = await prefetchUrls("Check https://example.com for data");
		expect(results.get("https://example.com")).toBe("Hello world");
	});

	it("converts HTML response to plain text", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response("<h1>Title</h1><p>Body</p>", {
				headers: { "content-type": "text/html; charset=utf-8" },
			}),
		);

		const results = await prefetchUrls("Check https://example.com for info");
		expect(results.get("https://example.com")).toBe("plain: <h1>Title</h1><p>Body</p>");
	});

	it("passes JSON response as raw string", async () => {
		const jsonBody = JSON.stringify({ key: "value" });
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response(jsonBody, {
				headers: { "content-type": "application/json" },
			}),
		);

		const results = await prefetchUrls("Check https://api.example.com/data");
		expect(results.get("https://api.example.com/data")).toBe(jsonBody);
	});

	it("returns failure note on fetch error", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValue(new Error("Network error"));

		const results = await prefetchUrls("Check https://example.com for data");
		expect(results.get("https://example.com")).toMatch(/\[Failed to fetch.*Network error\]/);
	});

	it("returns failure note on timeout", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValue(
			new DOMException("The operation was aborted", "AbortError"),
		);

		const results = await prefetchUrls("Check https://example.com for data");
		expect(results.get("https://example.com")).toMatch(/\[Failed to fetch.*aborted\]/i);
	});
});

describe("SSRF and size limits", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("skips private URL and records SSRF-blocked message", async () => {
		const results = await prefetchUrls(
			"Check http://127.0.0.1/internal and https://example.com/public",
		);
		// The private URL should be blocked without fetch
		expect(results.get("http://127.0.0.1/internal")).toMatch(/SSRF blocked/);
		// fetch should only have been called for the public URL
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("truncates response when Content-Length exceeds 1MB", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response("small body", {
				headers: {
					"content-type": "text/plain",
					"content-length": String(2 * 1024 * 1024),
				},
			}),
		);

		const results = await prefetchUrls("Check https://example.com/large");
		expect(results.get("https://example.com/large")).toMatch(/Content truncated at 1MB/);
	});

	it("truncates response when body stream exceeds 1MB", async () => {
		// Create a body larger than 1MB without Content-Length header
		const largeBody = "x".repeat(1_048_576 + 100);
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response(largeBody, {
				headers: { "content-type": "text/plain" },
			}),
		);

		const results = await prefetchUrls("Check https://example.com/stream");
		expect(results.get("https://example.com/stream")).toMatch(/Content truncated at 1MB/);
	});

	it("returns full content for responses under 1MB", async () => {
		const smallBody = "Hello, this is under 1MB";
		vi.mocked(globalThis.fetch).mockResolvedValue(
			new Response(smallBody, {
				headers: { "content-type": "text/plain" },
			}),
		);

		const results = await prefetchUrls("Check https://example.com/small");
		expect(results.get("https://example.com/small")).toBe(smallBody);
	});
});

describe("buildPrompt", () => {
	it("returns task description unchanged when no context data", () => {
		const result = buildPrompt("Do the thing", new Map());
		expect(result).toBe("Do the thing");
	});

	it("appends pre-fetched data sections to task description", () => {
		const contextData = new Map([
			["https://example.com", "Some content"],
			["https://api.example.com/data", '{"key":"value"}'],
		]);
		const result = buildPrompt("Do the thing", contextData);
		expect(result).toContain("Do the thing");
		expect(result).toContain("Pre-fetched reference data:");
		expect(result).toContain("--- Content from https://example.com ---");
		expect(result).toContain("Some content");
		expect(result).toContain("--- End ---");
		expect(result).toContain("--- Content from https://api.example.com/data ---");
		expect(result).toContain('{"key":"value"}');
	});
});
