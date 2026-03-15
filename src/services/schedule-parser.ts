import { generateText, NoObjectGeneratedError, Output } from "ai";
import { Cron } from "croner";
import cronstrue from "cronstrue";
import { DEFAULT_MODEL, resolveModel } from "../config/llm-provider.js";
import { isCronExpression } from "../helpers/cron-detect.js";
import type { ParseScheduleResponse, ScheduleParseResult } from "../schemas/schedule-input.js";
import { scheduleParseSchema } from "../schemas/schedule-input.js";

/**
 * Build the system prompt instructing the LLM to convert natural language to cron.
 */
function buildParsePrompt(input: string): string {
	return `Convert this natural language schedule description to a standard 5-field cron expression.

Input: "${input}"

Rules:
- Use standard 5-field cron: minute hour day-of-month month day-of-week
- Use numeric values for days of week (0=Sunday, 1=Monday, ..., 6=Saturday)
- If the input is ambiguous but still describes a schedule, set confidence to "low"
- If the input is NOT a schedule at all, set confidence to "refused" and cronExpression to "REFUSED".
  REFUSE these: "sometimes in the morning", "when I feel like it", "make me a sandwich", "not too often", "occasionally", random text.
  ACCEPT these (they ARE valid schedules): "every day at 7am", "every weekday at 9am", "every Monday at 8am", "every 3 hours", "daily", "hourly", "twice a day".
- Common mappings:
  - "weekday" = Monday through Friday (1-5)
  - "daily" = every day (default midnight if no time specified)
  - "hourly" = every hour
  - "twice a day" = 0 9,17 * * * (9am and 5pm by default)
  - "every 3 hours" = 0 */3 * * *
  - "the first of every month" = 0 0 1 * *
- If no time is specified for a daily/weekly schedule, default to midnight (0 0) and set confidence to "low"`;
}

/**
 * Parse a schedule input. If it is already a valid cron expression, describe it
 * directly without an LLM call. Otherwise, use the LLM to translate natural
 * language to cron, validate with croner, and describe with cronstrue.
 */
export async function parseSchedule(input: string): Promise<ParseScheduleResponse> {
	const trimmed = input.trim();

	// Fast path: input is already a valid cron expression
	if (isCronExpression(trimmed)) {
		const humanReadable = cronstrue.toString(trimmed, { use24HourTimeFormat: true });
		return {
			input,
			cronExpression: trimmed,
			humanReadable,
			confidence: "high",
			interpretation: "Input is already a valid cron expression",
		};
	}

	// Translate natural language via LLM
	const model = await resolveModel(DEFAULT_MODEL);
	const prompt = buildParsePrompt(trimmed);

	let result: ScheduleParseResult;
	try {
		const llmResult = await generateText({
			model,
			output: Output.object({ schema: scheduleParseSchema }),
			prompt,
		});
		result = llmResult.output as ScheduleParseResult;
	} catch (error) {
		if (NoObjectGeneratedError.isInstance(error)) {
			// Retry once with error feedback appended
			const errorMsg = error instanceof Error ? error.message : String(error);
			const retryPrompt = `${prompt}\n\n[Previous attempt failed: ${errorMsg}]\nPlease provide a valid 5-field cron expression.`;
			const retryResult = await generateText({
				model,
				output: Output.object({ schema: scheduleParseSchema }),
				prompt: retryPrompt,
			});
			result = retryResult.output as ScheduleParseResult;
		} else {
			throw error;
		}
	}

	// Refuse non-schedule inputs
	if (result.confidence === "refused") {
		throw new Error("Input is not a recognizable schedule description");
	}

	// Validate the generated cron expression with croner
	try {
		const job = new Cron(result.cronExpression, { paused: true });
		job.stop();
	} catch {
		throw new Error("LLM generated an invalid cron expression");
	}

	// Generate human-readable description
	const humanReadable = cronstrue.toString(result.cronExpression, { use24HourTimeFormat: true });

	const response: ParseScheduleResponse = {
		input,
		cronExpression: result.cronExpression,
		humanReadable,
		confidence: result.confidence,
		interpretation: result.interpretation,
	};

	// Add warning for low-confidence results
	if (result.confidence === "low") {
		response.warning = "This interpretation may not match your intent. Please verify.";
	}

	return response;
}
