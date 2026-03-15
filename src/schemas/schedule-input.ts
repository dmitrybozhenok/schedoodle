import { z } from "zod";

/**
 * Request body schema for the schedule parse endpoint.
 */
export const parseScheduleBody = z.object({
	input: z.string().min(1).max(500),
});

/**
 * Zod schema for LLM structured output — defines the shape the LLM must return.
 */
export const scheduleParseSchema = z.object({
	cronExpression: z
		.string()
		.describe("Standard 5-field cron expression (minute hour day-of-month month day-of-week)"),
	confidence: z
		.enum(["high", "low", "refused"])
		.describe(
			"high if the input clearly maps to a single cron schedule, low if ambiguous, refused if the input is not a recognizable schedule description",
		),
	interpretation: z
		.string()
		.describe("Brief explanation of how the input was interpreted"),
});

export type ScheduleParseResult = z.infer<typeof scheduleParseSchema>;

export type ParseScheduleResponse = {
	input: string;
	cronExpression: string;
	humanReadable: string;
	confidence: "high" | "low" | "refused";
	interpretation: string;
	warning?: string;
};
