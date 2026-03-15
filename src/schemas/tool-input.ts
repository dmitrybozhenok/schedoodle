import { z } from "zod";

export const createToolSchema = z.object({
	name: z.string().min(1).max(100),
	description: z.string().min(1),
	url: z.string().url(),
	method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
	headers: z.record(z.string(), z.string()).optional(),
	inputSchema: z.record(z.string(), z.any()),
});

export const updateToolSchema = createToolSchema.partial();

export type CreateToolInput = z.infer<typeof createToolSchema>;
export type UpdateToolInput = z.infer<typeof updateToolSchema>;
