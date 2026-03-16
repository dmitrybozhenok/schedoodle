import { z } from "zod";

export const telegramIntentSchema = z.object({
	action: z
		.enum([
			"list",
			"run",
			"enable",
			"disable",
			"status",
			"reschedule",
			"create",
			"delete",
			"update_task",
			"rename",
			"unknown",
		])
		.describe("The user's intended action"),
	agentName: z
		.string()
		.nullable()
		.describe(
			"Exact agent name from the provided list, or the new agent name for 'create' action, or null for list/status/unknown",
		),
	scheduleInput: z
		.string()
		.nullable()
		.describe(
			"Natural language schedule text for reschedule or create actions, or null for other actions",
		),
	taskDescription: z
		.string()
		.nullable()
		.describe(
			"Task description for create or update_task actions, or null for other actions",
		),
	newName: z
		.string()
		.nullable()
		.describe("New name for rename action, or null for other actions"),
});

export type TelegramIntent = z.infer<typeof telegramIntentSchema>;
