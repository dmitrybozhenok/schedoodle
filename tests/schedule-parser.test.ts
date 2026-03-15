import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock AI SDK modules before any imports that use them
const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
	generateText: (...args: unknown[]) => mockGenerateText(...args),
	Output: {
		object: vi.fn(({ schema }: { schema: unknown }) => ({
			type: "object",
			schema,
		})),
	},
	NoObjectGeneratedError: {
		isInstance: (err: unknown) =>
			err instanceof Error && (err as Error & { _isNoObject?: boolean })._isNoObject === true,
	},
}));

vi.mock("../src/config/llm-provider.js", () => ({
	DEFAULT_MODEL: "claude-haiku-4-5-20251001",
	resolveModel: vi.fn(async () => "mock-model"),
}));

import { parseSchedule } from "../src/services/schedule-parser.js";

function makeNoObjectError(message = "Validation failed"): Error {
	const err = new Error(message) as Error & { _isNoObject: boolean };
	err._isNoObject = true;
	return err;
}

describe("parseSchedule", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("translates NL input via LLM and returns ParseScheduleResponse with humanReadable from cronstrue", async () => {
		mockGenerateText.mockResolvedValue({
			output: {
				cronExpression: "0 9 * * 1-5",
				confidence: "high",
				interpretation: "Every weekday at 9am",
			},
		});

		const result = await parseSchedule("every weekday at 9am");

		expect(result.input).toBe("every weekday at 9am");
		expect(result.cronExpression).toBe("0 9 * * 1-5");
		expect(result.humanReadable).toBe("At 09:00, Monday through Friday");
		expect(result.confidence).toBe("high");
		expect(result.interpretation).toBe("Every weekday at 9am");
		expect(result.warning).toBeUndefined();
	});

	it("detects cron input and returns description without calling LLM", async () => {
		const result = await parseSchedule("0 9 * * 1-5");

		expect(mockGenerateText).not.toHaveBeenCalled();
		expect(result.cronExpression).toBe("0 9 * * 1-5");
		expect(result.humanReadable).toBe("At 09:00, Monday through Friday");
		expect(result.confidence).toBe("high");
		expect(result.interpretation).toBe("Input is already a valid cron expression");
	});

	it("includes warning field when LLM returns low confidence", async () => {
		mockGenerateText.mockResolvedValue({
			output: {
				cronExpression: "0 9,17 * * *",
				confidence: "low",
				interpretation: "Assumed twice a day means 9am and 5pm",
			},
		});

		const result = await parseSchedule("twice a day");

		expect(result.confidence).toBe("low");
		expect(result.warning).toBe("This interpretation may not match your intent. Please verify.");
	});

	it("throws when LLM returns invalid cron expression (croner rejects)", async () => {
		mockGenerateText.mockResolvedValue({
			output: {
				cronExpression: "not a cron",
				confidence: "high",
				interpretation: "test",
			},
		});

		await expect(parseSchedule("something")).rejects.toThrow(
			"LLM generated an invalid cron expression",
		);
	});

	it("retries once with error feedback on NoObjectGeneratedError", async () => {
		mockGenerateText
			.mockRejectedValueOnce(makeNoObjectError("schema mismatch"))
			.mockResolvedValueOnce({
				output: {
					cronExpression: "0 9 * * 1-5",
					confidence: "high",
					interpretation: "Retry succeeded",
				},
			});

		const result = await parseSchedule("every weekday at 9am");

		expect(mockGenerateText).toHaveBeenCalledTimes(2);
		// Second call should have the validation error appended
		const secondCallPrompt = mockGenerateText.mock.calls[1][0].prompt;
		expect(secondCallPrompt).toContain("schema mismatch");
		expect(result.cronExpression).toBe("0 9 * * 1-5");
	});

	it("throws when LLM fails after retry", async () => {
		mockGenerateText
			.mockRejectedValueOnce(makeNoObjectError("first fail"))
			.mockRejectedValueOnce(new Error("LLM crashed"));

		await expect(parseSchedule("every weekday at 9am")).rejects.toThrow("LLM crashed");
	});

	it("validates cron expression from LLM with croner before returning", async () => {
		// LLM returns a valid-looking but syntactically wrong cron
		mockGenerateText.mockResolvedValue({
			output: {
				cronExpression: "99 99 99 99 99",
				confidence: "high",
				interpretation: "test",
			},
		});

		await expect(parseSchedule("something weird")).rejects.toThrow(
			"LLM generated an invalid cron expression",
		);
	});
});
