import { describe, expect, it } from "vitest";
import { isCronExpression } from "../src/helpers/cron-detect.js";

describe("isCronExpression", () => {
	it("returns true for a valid 5-field weekday cron", () => {
		expect(isCronExpression("0 9 * * 1-5")).toBe(true);
	});

	it("returns true for every 5 minutes", () => {
		expect(isCronExpression("*/5 * * * *")).toBe(true);
	});

	it("returns true for monthly (first of month at midnight)", () => {
		expect(isCronExpression("0 0 1 * *")).toBe(true);
	});

	it("returns false for natural language: every weekday at 9am", () => {
		expect(isCronExpression("every weekday at 9am")).toBe(false);
	});

	it("returns false for natural language: twice a day", () => {
		expect(isCronExpression("twice a day")).toBe(false);
	});

	it("returns false for random text: hello", () => {
		expect(isCronExpression("hello")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isCronExpression("")).toBe(false);
	});

	it("returns false for only 4 fields", () => {
		expect(isCronExpression("0 9 * *")).toBe(false);
	});

	it("returns false for 5 words that are not cron characters", () => {
		expect(isCronExpression("invalid cron here more fields")).toBe(false);
	});
});
