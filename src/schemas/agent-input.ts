import { z } from "zod";

export const createAgentSchema = z.object({
	name: z.string().min(1).max(100),
	taskDescription: z.string().min(1).max(10_000),
	cronSchedule: z.string().min(1).max(500),
	systemPrompt: z.string().max(5_000).optional(),
	model: z.string().max(100).optional(),
	enabled: z.boolean().optional(),
});

export const updateAgentSchema = createAgentSchema.partial();

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
