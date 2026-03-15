import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { parseScheduleBody } from "../schemas/schedule-input.js";
import { CircuitBreakerOpenError } from "../services/circuit-breaker.js";
import { parseSchedule } from "../services/schedule-parser.js";

/**
 * Zod validation error hook: maps issues to { field, message } details array.
 */
function zodErrorHook(
	result: {
		success: boolean;
		error?: { issues: Array<{ path: (string | number)[]; message: string }> };
	},
	c: { json: (data: unknown, status: number) => Response },
) {
	if (!result.success) {
		const details = result.error?.issues.map((issue) => ({
			field: issue.path.join("."),
			message: issue.message,
		}));
		return c.json({ error: "Validation failed", details }, 400);
	}
}

/**
 * Factory function to create schedule routes.
 * No database dependency -- this route only calls the schedule parser service.
 */
export function createScheduleRoutes(): Hono {
	const app = new Hono();

	// POST /parse - Parse natural language schedule into cron expression
	app.post("/parse", zValidator("json", parseScheduleBody, zodErrorHook as never), async (c) => {
		const { input } = c.req.valid("json" as never) as { input: string };

		try {
			const result = await parseSchedule(input);
			return c.json(result);
		} catch (error) {
			if (error instanceof CircuitBreakerOpenError) {
				return c.json(
					{
						error: "Schedule parsing temporarily unavailable",
						message:
							"The LLM provider is currently unavailable. Please provide a cron expression directly (e.g., '0 9 * * 1-5').",
					},
					503,
				);
			}

			return c.json(
				{
					error: "Could not parse schedule",
					message:
						"Unable to interpret the schedule description. Try a simpler phrase like 'every weekday at 9am' or 'every 3 hours'.",
					suggestions: [
						"every day at 9am",
						"every weekday at 9am",
						"every hour",
						"every Monday at 8am",
					],
				},
				422,
			);
		}
	});

	return app;
}
