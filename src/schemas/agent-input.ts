import { z } from "zod";

export const createAgentSchema = z.object({
	name: z.string().min(1).max(100),
	taskDescription: z.string().min(1),
	cronSchedule: z.string().min(1).max(500),
	systemPrompt: z.string().optional(),
	model: z.string().optional(),
	enabled: z.boolean().optional(),
});

export const updateAgentSchema = createAgentSchema.partial();

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
