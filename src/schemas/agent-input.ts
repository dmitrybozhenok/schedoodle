import { z } from "zod";
import { Cron } from "croner";

const cronExpression = z.string().refine(
	(val) => {
		try {
			const job = new Cron(val, { paused: true });
			job.stop();
			return true;
		} catch {
			return false;
		}
	},
	{ message: "Invalid cron expression" },
);

export const createAgentSchema = z.object({
	name: z.string().min(1).max(100),
	taskDescription: z.string().min(1),
	cronSchedule: cronExpression,
	systemPrompt: z.string().optional(),
	model: z.string().optional(),
});

export const updateAgentSchema = createAgentSchema.partial();

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
