import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("escapeMdV2", () => {
	it("escapes all 18 MarkdownV2 special characters", async () => {
		const { escapeMdV2 } = await import("../src/services/telegram.js");
		const input = '_*[]()~`>#+-=|{}.!\\';
		const expected = '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\';
		expect(escapeMdV2(input)).toBe(expected);
	});

	it("returns text unchanged when no special characters", async () => {
		const { escapeMdV2 } = await import("../src/services/telegram.js");
		expect(escapeMdV2("no specials")).toBe("no specials");
	});

	it("escapes mixed content correctly", async () => {
		const { escapeMdV2 } = await import("../src/services/telegram.js");
		expect(escapeMdV2("hello_world*test")).toBe("hello\\_world\\*test");
	});
});

describe("escapeMdV2CodeBlock", () => {
	it("escapes backtick and backslash only", async () => {
		const { escapeMdV2CodeBlock } = await import("../src/services/telegram.js");
		expect(escapeMdV2CodeBlock("code`with\\slash")).toBe("code\\`with\\\\slash");
	});

	it("does not escape other special characters", async () => {
		const { escapeMdV2CodeBlock } = await import("../src/services/telegram.js");
		expect(escapeMdV2CodeBlock("dots.and[brackets]")).toBe("dots.and[brackets]");
	});
});

describe("sendTelegramMessage", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("posts to correct URL with correct body shape", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ ok: true, result: {} }),
		});
		globalThis.fetch = mockFetch;

		const { sendTelegramMessage } = await import("../src/services/telegram.js");
		await sendTelegramMessage("bot123", "chat456", "Hello");

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, opts] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.telegram.org/botbot123/sendMessage");
		expect(opts.method).toBe("POST");
		expect(opts.headers).toEqual({ "Content-Type": "application/json" });

		const body = JSON.parse(opts.body);
		expect(body.chat_id).toBe("chat456");
		expect(body.text).toBe("Hello");
		expect(body.parse_mode).toBe("MarkdownV2");
		expect(body.link_preview_options).toEqual({ is_disabled: true });
	});

	it("returns { ok: true } on successful API response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
		});

		const { sendTelegramMessage } = await import("../src/services/telegram.js");
		const result = await sendTelegramMessage("token", "chat", "msg");
		expect(result.ok).toBe(true);
	});

	it("returns { ok: false, description } on API error", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			json: () => Promise.resolve({ ok: false, description: "Bad Request: chat not found" }),
		});

		const { sendTelegramMessage } = await import("../src/services/telegram.js");
		const result = await sendTelegramMessage("token", "chat", "msg");
		expect(result.ok).toBe(false);
		expect(result.description).toBe("Bad Request: chat not found");
	});

	it("propagates fetch errors (network failure)", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

		const { sendTelegramMessage } = await import("../src/services/telegram.js");
		await expect(sendTelegramMessage("token", "chat", "msg")).rejects.toThrow("Network error");
	});
});
