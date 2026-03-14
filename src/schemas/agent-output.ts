import { z } from "zod";

export const agentOutputSchema = z.object({
	summary: z.string().describe("A concise summary of the task result"),
	details: z.string().describe("Detailed findings or output"),
	data: z
		.string()
		.optional()
		.describe("Optional extra data relevant to the task, as a JSON string"),
});

export type AgentOutput = z.infer<typeof agentOutputSchema>;
