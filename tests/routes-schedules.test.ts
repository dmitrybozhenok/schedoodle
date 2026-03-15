import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreakerOpenError } from "../src/services/circuit-breaker.js";

// Mock schedule-parser service
const mockParseSchedule = vi.fn();

vi.mock("../src/services/schedule-parser.js", () => ({
	parseSchedule: (...args: unknown[]) => mockParseSchedule(...args),
}));

import { createScheduleRoutes } from "../src/routes/schedules.js";

function buildApp() {
	const app = new Hono();
	app.route("/schedules", createScheduleRoutes());
	return app;
}

describe("POST /schedules/parse", () => {
	let app: Hono;

	beforeEach(() => {
		app = buildApp();
		vi.clearAllMocks();
	});

	it("returns 200 with parsed schedule for valid NL input", async () => {
		mockParseSchedule.mockResolvedValue({
			input: "every weekday at 9am",
			cronExpression: "0 9 * * 1-5",
			humanReadable: "At 09:00, Monday through Friday",
			confidence: "high",
			interpretation: "Every weekday at 9am",
		});

		const res = await app.request("/schedules/parse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: "every weekday at 9am" }),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.input).toBe("every weekday at 9am");
		expect(body.cronExpression).toBe("0 9 * * 1-5");
		expect(body.humanReadable).toBe("At 09:00, Monday through Friday");
		expect(body.confidence).toBe("high");
		expect(body.interpretation).toBe("Every weekday at 9am");
		expect(body.warning).toBeUndefined();
	});

	it("returns 200 with cron bypass response (no LLM call)", async () => {
		mockParseSchedule.mockResolvedValue({
			input: "0 9 * * 1-5",
			cronExpression: "0 9 * * 1-5",
			humanReadable: "At 09:00, Monday through Friday",
			confidence: "high",
			interpretation: "Input is already a valid cron expression",
		});

		const res = await app.request("/schedules/parse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: "0 9 * * 1-5" }),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.interpretation).toBe("Input is already a valid cron expression");
		expect(mockParseSchedule).toHaveBeenCalledWith("0 9 * * 1-5");
	});

	it("returns 400 with validation error for empty input", async () => {
		const res = await app.request("/schedules/parse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: "" }),
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Validation failed");
		expect(body.details).toBeInstanceOf(Array);
		expect(body.details.length).toBeGreaterThan(0);
		expect(body.details[0]).toHaveProperty("field");
		expect(body.details[0]).toHaveProperty("message");
	});

	it("returns 400 when body is missing", async () => {
		const res = await app.request("/schedules/parse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Validation failed");
		expect(body.details).toBeInstanceOf(Array);
	});

	it("returns 200 with warning for low confidence input", async () => {
		mockParseSchedule.mockResolvedValue({
			input: "twice a day",
			cronExpression: "0 9,17 * * *",
			humanReadable: "At 09:00 and 17:00",
			confidence: "low",
			interpretation: "Assumed twice a day means 9am and 5pm",
			warning: "This interpretation may not match your intent. Please verify.",
		});

		const res = await app.request("/schedules/parse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: "twice a day" }),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.confidence).toBe("low");
		expect(body.warning).toBe(
			"This interpretation may not match your intent. Please verify.",
		);
	});

	it("returns 422 with guidance when parseSchedule throws generic Error", async () => {
		mockParseSchedule.mockRejectedValue(new Error("LLM generated an invalid cron expression"));

		const res = await app.request("/schedules/parse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: "do something weird" }),
		});

		expect(res.status).toBe(422);
		const body = await res.json();
		expect(body.error).toBe("Could not parse schedule");
		expect(body.message).toContain("Unable to interpret");
		expect(body.suggestions).toBeInstanceOf(Array);
		expect(body.suggestions.length).toBeGreaterThan(0);
	});

	it("returns 503 when parseSchedule throws CircuitBreakerOpenError", async () => {
		mockParseSchedule.mockRejectedValue(new CircuitBreakerOpenError("llm"));

		const res = await app.request("/schedules/parse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: "every day at noon" }),
		});

		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error).toBe("Schedule parsing temporarily unavailable");
		expect(body.message).toContain("cron expression directly");
	});

	it("returns 404 for GET /schedules/parse (only POST supported)", async () => {
		const res = await app.request("/schedules/parse", {
			method: "GET",
		});

		expect(res.status).toBe(404);
	});
});
