import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", () => ({
	env: {
		DATABASE_URL: "./data/schedoodle.db",
		LLM_PROVIDER: "anthropic",
		ANTHROPIC_API_KEY: "test-key",
		OLLAMA_BASE_URL: "http://127.0.0.1:11434/api",
		PORT: 3000,
	},
}));

import { createWebhookTool } from "../src/services/tools/webhook.js";
import type { Tool } from "../src/types/index.js";

function makeTool(overrides: Partial<Tool> = {}): Tool {
	return {
		id: 1,
		name: "Test Webhook",
		description: "A test webhook tool",
		url: "https://api.example.com/hook",
		method: "POST",
		headers: null,
		inputSchema: {
			type: "object",
			properties: {
				message: { type: "string" },
			},
			required: ["message"],
		},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

describe("createWebhookTool", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("creates an AI SDK tool from a DB record with correct description", () => {
		const toolDef = makeTool({ description: "Sends data to my API" });
		const webhookTool = createWebhookTool(toolDef);

		expect(webhookTool).toBeDefined();
		expect(webhookTool.description).toBe("Sends data to my API");
		expect(webhookTool.execute).toBeTypeOf("function");
	});

	it("sends HTTP request with correct method, headers, and JSON body", async () => {
		const toolDef = makeTool({ method: "POST" });
		const webhookTool = createWebhookTool(toolDef);

		globalThis.fetch = vi.fn().mockResolvedValue({
			text: vi.fn().mockResolvedValue("OK"),
		});

		await webhookTool.execute?.(
			{ message: "hello" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
		expect(fetchCall[0]).toBe("https://api.example.com/hook");
		expect(fetchCall[1]?.method).toBe("POST");
		expect(fetchCall[1]?.headers).toMatchObject({ "Content-Type": "application/json" });
		expect(fetchCall[1]?.body).toBe(JSON.stringify({ message: "hello" }));
	});

	it("returns response text on success", async () => {
		const toolDef = makeTool();
		const webhookTool = createWebhookTool(toolDef);

		globalThis.fetch = vi.fn().mockResolvedValue({
			text: vi.fn().mockResolvedValue('{"result": "processed"}'),
		});

		const result = await webhookTool.execute?.(
			{ message: "hello" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		expect(result).toBe('{"result": "processed"}');
	});

	it("returns failure message on network error (does not throw)", async () => {
		const toolDef = makeTool({ name: "MyWebhook" });
		const webhookTool = createWebhookTool(toolDef);

		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

		const result = await webhookTool.execute?.(
			{ message: "hello" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		expect(result).toContain("[Webhook MyWebhook failed:");
		expect(result).toContain("Connection refused");
	});

	it("respects abort signal with combined 10s per-call timeout", async () => {
		const toolDef = makeTool();
		const webhookTool = createWebhookTool(toolDef);

		const controller = new AbortController();
		controller.abort();

		globalThis.fetch = vi
			.fn()
			.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

		const result = await webhookTool.execute?.(
			{ message: "hello" },
			{ abortSignal: controller.signal, toolCallId: "test", messages: [] },
		);

		expect(result).toContain("[Webhook");
		expect(result).toContain("failed:");
	});

	it("merges static headers from DB record", async () => {
		const toolDef = makeTool({
			headers: { Authorization: "Bearer xxx", "X-Custom": "value" } as unknown as null,
		});
		const webhookTool = createWebhookTool(toolDef);

		globalThis.fetch = vi.fn().mockResolvedValue({
			text: vi.fn().mockResolvedValue("OK"),
		});

		await webhookTool.execute?.(
			{ message: "hello" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
		expect(fetchCall[1]?.headers).toMatchObject({
			"Content-Type": "application/json",
			Authorization: "Bearer xxx",
			"X-Custom": "value",
		});
	});

	it("does not send body for GET requests", async () => {
		const toolDef = makeTool({ method: "GET" });
		const webhookTool = createWebhookTool(toolDef);

		globalThis.fetch = vi.fn().mockResolvedValue({
			text: vi.fn().mockResolvedValue("response"),
		});

		await webhookTool.execute?.(
			{ message: "hello" },
			{ abortSignal: AbortSignal.timeout(5000), toolCallId: "test", messages: [] },
		);

		const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
		expect(fetchCall[1]?.body).toBeUndefined();
	});
});
