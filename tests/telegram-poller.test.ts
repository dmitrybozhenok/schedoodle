import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Store original fetch
const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();

describe("telegram-poller", () => {
	beforeEach(() => {
		vi.resetModules();
		globalThis.fetch = mockFetch;
		mockFetch.mockReset();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	/**
	 * Helper: create a mock fetch response returning the given data.
	 */
	function mockFetchResponse(data: unknown) {
		return Promise.resolve({
			json: () => Promise.resolve(data),
		});
	}

	it("calls getUpdates with correct URL and parameters", async () => {
		// First call returns empty, then we stop polling
		let callCount = 0;
		mockFetch.mockImplementation(() => {
			callCount++;
			if (callCount >= 2) {
				// Stop after first successful poll
				import("../src/services/telegram-poller.js").then((m) => m.stopPolling());
			}
			return mockFetchResponse({ ok: true, result: [] });
		});

		const { startPolling, stopPolling } = await import("../src/services/telegram-poller.js");
		const onMessage = vi.fn(async () => {});
		startPolling("test-token", "123", onMessage);

		// Allow poll loop to run
		await new Promise((r) => setTimeout(r, 100));
		stopPolling();

		expect(mockFetch).toHaveBeenCalled();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.telegram.org/bottest-token/getUpdates");
		expect(options.method).toBe("POST");
		expect(options.headers).toEqual({ "Content-Type": "application/json" });
		const body = JSON.parse(options.body);
		expect(body.offset).toBe(0);
		expect(body.timeout).toBe(30);
		expect(body.allowed_updates).toEqual(["message"]);
	});

	it("increments offset after processing updates", async () => {
		let callCount = 0;
		mockFetch.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return mockFetchResponse({
					ok: true,
					result: [
						{
							update_id: 100,
							message: {
								message_id: 1,
								chat: { id: 123, type: "private" },
								text: "hello",
								date: 1,
							},
						},
						{
							update_id: 101,
							message: {
								message_id: 2,
								chat: { id: 123, type: "private" },
								text: "world",
								date: 2,
							},
						},
					],
				});
			}
			// On subsequent calls, stop polling
			import("../src/services/telegram-poller.js").then((m) => m.stopPolling());
			return mockFetchResponse({ ok: true, result: [] });
		});

		const { startPolling } = await import("../src/services/telegram-poller.js");
		const onMessage = vi.fn(async () => {});
		startPolling("test-token", "123", onMessage);

		await new Promise((r) => setTimeout(r, 200));

		// Second call should have offset = 102 (101 + 1)
		expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
		const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
		expect(secondCallBody.offset).toBe(102);
	});

	it("calls onMessage for authorized chat ID", async () => {
		let callCount = 0;
		mockFetch.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return mockFetchResponse({
					ok: true,
					result: [
						{
							update_id: 200,
							message: {
								message_id: 10,
								chat: { id: 123, type: "private" },
								text: "run briefing",
								date: 1000,
							},
						},
					],
				});
			}
			import("../src/services/telegram-poller.js").then((m) => m.stopPolling());
			return mockFetchResponse({ ok: true, result: [] });
		});

		const { startPolling } = await import("../src/services/telegram-poller.js");
		const onMessage = vi.fn(async () => {});
		startPolling("test-token", "123", onMessage);

		await new Promise((r) => setTimeout(r, 200));

		expect(onMessage).toHaveBeenCalledTimes(1);
		expect(onMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				message_id: 10,
				text: "run briefing",
				chat: { id: 123, type: "private" },
			}),
		);
	});

	it("silently ignores messages from unauthorized chat IDs", async () => {
		let callCount = 0;
		mockFetch.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return mockFetchResponse({
					ok: true,
					result: [
						{
							update_id: 300,
							message: {
								message_id: 20,
								chat: { id: 999, type: "private" },
								text: "hack attempt",
								date: 1000,
							},
						},
					],
				});
			}
			import("../src/services/telegram-poller.js").then((m) => m.stopPolling());
			return mockFetchResponse({ ok: true, result: [] });
		});

		const { startPolling } = await import("../src/services/telegram-poller.js");
		const onMessage = vi.fn(async () => {});
		startPolling("test-token", "123", onMessage);

		await new Promise((r) => setTimeout(r, 200));

		expect(onMessage).not.toHaveBeenCalled();
	});

	it("silently ignores updates without text", async () => {
		let callCount = 0;
		mockFetch.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return mockFetchResponse({
					ok: true,
					result: [
						{
							update_id: 400,
							message: {
								message_id: 30,
								chat: { id: 123, type: "private" },
								// No text field — e.g., a photo or sticker
								date: 1000,
							},
						},
					],
				});
			}
			import("../src/services/telegram-poller.js").then((m) => m.stopPolling());
			return mockFetchResponse({ ok: true, result: [] });
		});

		const { startPolling } = await import("../src/services/telegram-poller.js");
		const onMessage = vi.fn(async () => {});
		startPolling("test-token", "123", onMessage);

		await new Promise((r) => setTimeout(r, 200));

		expect(onMessage).not.toHaveBeenCalled();
	});

	it("recovers from fetch errors with 5s delay", async () => {
		vi.useFakeTimers();
		let callCount = 0;
		mockFetch.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.reject(new Error("Network failure"));
			}
			// Second call succeeds
			import("../src/services/telegram-poller.js").then((m) => m.stopPolling());
			return mockFetchResponse({ ok: true, result: [] });
		});

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const { startPolling } = await import("../src/services/telegram-poller.js");
		const onMessage = vi.fn(async () => {});
		startPolling("test-token", "123", onMessage);

		// Let the first poll attempt run and fail
		await vi.advanceTimersByTimeAsync(10);

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("[telegram-bot] Polling error: Network failure"),
		);

		// Advance past the 5s delay
		await vi.advanceTimersByTimeAsync(5100);

		// Polling should have recovered and made a second call
		expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);

		consoleSpy.mockRestore();
		vi.useRealTimers();
	});

	it("stopPolling sets running to false", async () => {
		mockFetch.mockImplementation(() => {
			return mockFetchResponse({ ok: true, result: [] });
		});

		const { startPolling, stopPolling, isPollingActive } = await import(
			"../src/services/telegram-poller.js"
		);

		startPolling(
			"test-token",
			"123",
			vi.fn(async () => {}),
		);
		expect(isPollingActive()).toBe(true);

		stopPolling();
		expect(isPollingActive()).toBe(false);
	});

	it("sendPlainText sends message without parse_mode", async () => {
		mockFetch.mockImplementation(() => mockFetchResponse({ ok: true, result: { message_id: 1 } }));

		const { sendPlainText } = await import("../src/services/telegram-poller.js");
		await sendPlainText("test-token", "123", "Hello plain text");

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
		const body = JSON.parse(options.body);
		expect(body.chat_id).toBe("123");
		expect(body.text).toBe("Hello plain text");
		expect(body).not.toHaveProperty("parse_mode");
	});

	it("sendTypingAction sends typing chat action", async () => {
		mockFetch.mockImplementation(() => mockFetchResponse({ ok: true }));

		const { sendTypingAction } = await import("../src/services/telegram-poller.js");
		await sendTypingAction("test-token", "456");

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.telegram.org/bottest-token/sendChatAction");
		const body = JSON.parse(options.body);
		expect(body.chat_id).toBe("456");
		expect(body.action).toBe("typing");
	});
});
