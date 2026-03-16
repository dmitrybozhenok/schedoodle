import { z } from "zod";

export const telegramIntentSchema = z.object({
	action: z
		.enum(["list", "run", "enable", "disable", "status", "reschedule", "unknown"])
		.describe("The user's intended action"),
	agentName: z
		.string()
		.nullable()
		.describe(
			"Exact agent name from the provided list, or null if action doesn't target a specific agent (list, status, unknown)",
		),
	scheduleInput: z
		.string()
		.nullable()
		.describe(
			"The natural language schedule text for reschedule action, or null for other actions",
		),
});

export type TelegramIntent = z.infer<typeof telegramIntentSchema>;
