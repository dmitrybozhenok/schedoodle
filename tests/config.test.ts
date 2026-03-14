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

	it("rejects missing ANTHROPIC_API_KEY", () => {
		const result = loadEnvFromRecord({});
		expect(result.success).toBe(false);
	});

	it("rejects empty ANTHROPIC_API_KEY", () => {
		const result = loadEnvFromRecord({ ANTHROPIC_API_KEY: "" });
		expect(result.success).toBe(false);
	});
});
