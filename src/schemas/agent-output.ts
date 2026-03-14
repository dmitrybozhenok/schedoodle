import { z } from "zod";

export const agentOutputSchema = z.object({
	summary: z.string().describe("A concise summary of the task result"),
	details: z.string().describe("Detailed findings or output"),
	data: z.unknown().optional().describe("Optional structured data relevant to the task"),
});

export type AgentOutput = z.infer<typeof agentOutputSchema>;
