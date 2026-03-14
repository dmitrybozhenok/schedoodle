import { describe, expect, it } from "vitest";
import { loadEnvFromRecord } from "../src/config/env.js";

describe("config validation", () => {
	it("parses valid env", () => {
		const result = loadEnvFromRecord({
			ANTHROPIC_API_KEY: "test-key",
			DATABASE_URL: ":memory:",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.ANTHROPIC_API_KEY).toBe("test-key");
			expect(result.data.DATABASE_URL).toBe(":memory:");
		}
	});

	it("applies DATABASE_URL default", () => {
		const result = loadEnvFromRecord({
			ANTHROPIC_API_KEY: "test-key",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.DATABASE_URL).toBe("./data/schedoodle.db");
		}
	});

	it("rejects missing ANTHROPIC_API_KEY when provider is anthropic", () => {
		const result = loadEnvFromRecord({ LLM_PROVIDER: "anthropic" });
		expect(result.success).toBe(false);
	});

	it("rejects empty ANTHROPIC_API_KEY when provider is anthropic", () => {
		const result = loadEnvFromRecord({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "" });
		expect(result.success).toBe(false);
	});

	it("accepts missing ANTHROPIC_API_KEY when provider is ollama", () => {
		const result = loadEnvFromRecord({ LLM_PROVIDER: "ollama" });
		expect(result.success).toBe(true);
	});

	it("defaults LLM_PROVIDER to anthropic", () => {
		const result = loadEnvFromRecord({ ANTHROPIC_API_KEY: "test-key" });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.LLM_PROVIDER).toBe("anthropic");
		}
	});

	it("accepts ollama provider with OLLAMA_BASE_URL", () => {
		const result = loadEnvFromRecord({
			LLM_PROVIDER: "ollama",
			OLLAMA_BASE_URL: "http://localhost:11434/api",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.LLM_PROVIDER).toBe("ollama");
			expect(result.data.OLLAMA_BASE_URL).toBe("http://localhost:11434/api");
		}
	});

	it("accepts optional RESEND_API_KEY", () => {
		const result = loadEnvFromRecord({
			ANTHROPIC_API_KEY: "test-key",
			RESEND_API_KEY: "re_123",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.RESEND_API_KEY).toBe("re_123");
		}
	});

	it("accepts optional NOTIFICATION_EMAIL", () => {
		const result = loadEnvFromRecord({
			ANTHROPIC_API_KEY: "test-key",
			NOTIFICATION_EMAIL: "user@example.com",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.NOTIFICATION_EMAIL).toBe("user@example.com");
		}
	});

	it("rejects invalid NOTIFICATION_EMAIL format", () => {
		const result = loadEnvFromRecord({
			ANTHROPIC_API_KEY: "test-key",
			NOTIFICATION_EMAIL: "not-an-email",
		});
		expect(result.success).toBe(false);
	});

	it("accepts optional NOTIFICATION_FROM", () => {
		const result = loadEnvFromRecord({
			ANTHROPIC_API_KEY: "test-key",
			NOTIFICATION_FROM: "Schedoodle <noreply@example.com>",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.NOTIFICATION_FROM).toBe("Schedoodle <noreply@example.com>");
		}
	});

	it("works without any email env vars", () => {
		const result = loadEnvFromRecord({
			ANTHROPIC_API_KEY: "test-key",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.RESEND_API_KEY).toBeUndefined();
			expect(result.data.NOTIFICATION_EMAIL).toBeUndefined();
			expect(result.data.NOTIFICATION_FROM).toBeUndefined();
		}
	});
});
