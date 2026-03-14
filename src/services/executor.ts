import { NoObjectGeneratedError, Output, generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { eq } from "drizzle-orm";
import { agentOutputSchema } from "../schemas/agent-output.js";
import type { AgentOutput } from "../schemas/agent-output.js";
import { prefetchUrls, buildPrompt } from "../services/prefetch.js";
import { executionHistory } from "../db/schema.js";
import type { Database } from "../db/index.js";
import type { Agent } from "../types/index.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

type ExecuteSuccess = {
	status: "success";
	executionId: number;
	output: AgentOutput;
};

type ExecuteFailure = {
	status: "failure";
	executionId: number;
	error: string;
};

export type ExecuteResult = ExecuteSuccess | ExecuteFailure;

/**
 * Call the LLM with structured output and one retry on validation failure.
 */
async function callLlmWithRetry(
	modelId: string,
	systemPrompt: string | null,
	userMessage: string,
) {
	try {
		const result = await generateText({
			model: anthropic(modelId),
			system: systemPrompt ?? undefined,
			output: Output.object({ schema: agentOutputSchema }),
			prompt: userMessage,
		});
		return result;
	} catch (error) {
		if (NoObjectGeneratedError.isInstance(error)) {
			// Retry once with validation error appended as feedback
			const errorMsg =
				error instanceof Error ? error.message : String(error);
			const retryPrompt = `${userMessage}\n\n[Previous attempt failed validation: ${errorMsg}]\nPlease provide a valid response matching the required schema.`;

			const result = await generateText({
				model: anthropic(modelId),
				system: systemPrompt ?? undefined,
				output: Output.object({ schema: agentOutputSchema }),
				prompt: retryPrompt,
			});
			return result;
		}
		throw error;
	}
}

/**
 * Execute a single agent: prefetch URLs, call LLM, record result in DB.
 */
export async function executeAgent(
	agent: Agent,
	db: Database,
): Promise<ExecuteResult> {
	// Insert running record
	const inserted = db
		.insert(executionHistory)
		.values({
			agentId: agent.id,
			status: "running",
		})
		.returning()
		.get();

	const executionId = inserted.id;
	const startTime = Date.now();

	try {
		// Prefetch URLs from task description
		const contextData = await prefetchUrls(agent.taskDescription);
		const userMessage = buildPrompt(agent.taskDescription, contextData);

		// Call LLM with retry on validation failure
		const modelId = agent.model ?? DEFAULT_MODEL;
		const result = await callLlmWithRetry(
			modelId,
			agent.systemPrompt,
			userMessage,
		);

		const durationMs = Date.now() - startTime;
		const output = result.output as AgentOutput;

		// Update execution to success
		db.update(executionHistory)
			.set({
				status: "success",
				result: output,
				inputTokens: result.usage.inputTokens ?? null,
				outputTokens: result.usage.outputTokens ?? null,
				durationMs,
				completedAt: new Date().toISOString(),
			})
			.where(eq(executionHistory.id, executionId))
			.run();

		return { status: "success", executionId, output };
	} catch (error) {
		const durationMs = Date.now() - startTime;
		const errorMsg =
			error instanceof Error ? error.message : String(error);

		// Update execution to failure
		db.update(executionHistory)
			.set({
				status: "failure",
				error: errorMsg,
				durationMs,
				completedAt: new Date().toISOString(),
			})
			.where(eq(executionHistory.id, executionId))
			.run();

		return { status: "failure", executionId, error: errorMsg };
	}
}

/**
 * Execute multiple agents concurrently. One failure does not block others.
 */
export async function executeAgents(
	agents: Agent[],
	db: Database,
): Promise<PromiseSettledResult<ExecuteResult>[]> {
	return Promise.allSettled(agents.map((a) => executeAgent(a, db)));
}
