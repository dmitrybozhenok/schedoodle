import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock env
const mockEnv = {
	TELEGRAM_BOT_TOKEN: undefined as string | undefined,
	TELEGRAM_CHAT_ID: undefined as string | undefined,
};

vi.mock("../src/config/env.js", () => ({
	env: new Proxy(
		{},
		{
			get(_target, prop) {
				return (mockEnv as Record<string, unknown>)[prop as string];
			},
		},
	),
}));

// Mock telegram service
const mockSendTelegramMessage = vi.fn();
const mockEscapeMdV2 = vi.fn((text: string) => text);

vi.mock("../src/services/telegram.js", () => ({
	sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
	escapeMdV2: (...args: unknown[]) => mockEscapeMdV2(...args),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTelegramTools } from "../src/mcp/tools/telegram.js";

function parseResult(result: { content: Array<{ type: string; text?: string }> }) {
	const textContent = result.content.find((c) => c.type === "text");
	return textContent?.text ? JSON.parse(textContent.text) : null;
}

async function createTestEnv() {
	const server = new McpServer({ name: "test-telegram", version: "1.0.0" });
	registerTelegramTools(server);

	const client = new Client({ name: "test-client", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

	await server.connect(serverTransport);
	await client.connect(clientTransport);

	return { server, client };
}

describe("MCP Telegram Tools", () => {
	let client: Client;
	let server: McpServer;

	beforeEach(async () => {
		const env = await createTestEnv();
		client = env.client;
		server = env.server;
		vi.clearAllMocks();

		// Default: env vars not set
		mockEnv.TELEGRAM_BOT_TOKEN = undefined;
		mockEnv.TELEGRAM_CHAT_ID = undefined;
	});

	afterEach(async () => {
		await client.close();
		await server.close();
	});

	describe("test_telegram", () => {
		it("returns error when TELEGRAM_BOT_TOKEN not configured", async () => {
			mockEnv.TELEGRAM_BOT_TOKEN = undefined;
			mockEnv.TELEGRAM_CHAT_ID = "123456";

			const result = await client.callTool({ name: "test_telegram", arguments: {} });
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toContain("not configured");
			expect(data.guidance).toContain("TELEGRAM_BOT_TOKEN");
		});

		it("returns error when TELEGRAM_CHAT_ID not configured", async () => {
			mockEnv.TELEGRAM_BOT_TOKEN = "bot123:token";
			mockEnv.TELEGRAM_CHAT_ID = undefined;

			const result = await client.callTool({ name: "test_telegram", arguments: {} });
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toContain("not configured");
			expect(data.guidance).toContain("TELEGRAM_CHAT_ID");
		});

		it("returns success when sendTelegramMessage returns ok: true", async () => {
			mockEnv.TELEGRAM_BOT_TOKEN = "bot123:token";
			mockEnv.TELEGRAM_CHAT_ID = "123456";
			mockSendTelegramMessage.mockResolvedValue({ ok: true });

			const result = await client.callTool({ name: "test_telegram", arguments: {} });
			const data = parseResult(result);

			expect(result.isError).toBeFalsy();
			expect(data.status).toBe("sent");
			expect(mockSendTelegramMessage).toHaveBeenCalledWith(
				"bot123:token",
				"123456",
				expect.any(String),
			);
		});

		it("returns error when sendTelegramMessage returns ok: false", async () => {
			mockEnv.TELEGRAM_BOT_TOKEN = "bot123:token";
			mockEnv.TELEGRAM_CHAT_ID = "123456";
			mockSendTelegramMessage.mockResolvedValue({ ok: false, description: "Forbidden" });

			const result = await client.callTool({ name: "test_telegram", arguments: {} });
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toContain("Forbidden");
			expect(data.guidance).toContain("TELEGRAM_BOT_TOKEN");
		});

		it("returns error when sendTelegramMessage throws", async () => {
			mockEnv.TELEGRAM_BOT_TOKEN = "bot123:token";
			mockEnv.TELEGRAM_CHAT_ID = "123456";
			mockSendTelegramMessage.mockRejectedValue(new Error("Network error"));

			const result = await client.callTool({ name: "test_telegram", arguments: {} });
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toContain("Network error");
		});
	});
});
