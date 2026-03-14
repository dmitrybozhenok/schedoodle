import { anthropic } from "@ai-sdk/anthropic";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { eq } from "drizzle-orm";
import { estimateCost } from "../config/pricing.js";
import type { Database } from "../db/index.js";
import { executionHistory } from "../db/schema.js";
import type { AgentOutput } from "../schemas/agent-output.js";
import { agentOutputSchema } from "../schemas/agent-output.js";
import { buildPrompt, prefetchUrls } from "../services/prefetch.js";
import type { Agent } from "../types/index.js";
import { CircuitBreakerOpenError, createCircuitBreaker } from "./circuit-breaker.js";
import { sendNotification } from "./notifier.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

let llmBreaker = createCircuitBreaker({
	name: "anthropic",
	failureThreshold: 3,
	resetTimeoutMs: 30_000,
});

/**
 * Reset the LLM circuit breaker. Intended for test isolation only.
 */
export function _resetLlmBreaker() {
	llmBreaker = createCircuitBreaker({
		name: "anthropic",
		failureThreshold: 3,
		resetTimeoutMs: 30_000,
	});
}

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
 * Get the current circuit breaker status for the LLM provider.
 * Useful for health endpoints.
 */
export function getLlmCircuitStatus() {
	return llmBreaker.getStatus();
}

/**
 * Call the LLM with structured output and one retry on validation failure.
 */
async function callLlmWithRetry(modelId: string, systemPrompt: string | null, userMessage: string) {
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
			const errorMsg = error instanceof Error ? error.message : String(error);
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
export async function executeAgent(agent: Agent, db: Database): Promise<ExecuteResult> {
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

		// Call LLM with retry, wrapped in circuit breaker
		const modelId = agent.model ?? DEFAULT_MODEL;
		const result = await llmBreaker.execute(() =>
			callLlmWithRetry(modelId, agent.systemPrompt, userMessage),
		);

		const durationMs = Date.now() - startTime;
		const output = result.output as AgentOutput;

		// Compute estimated cost from token usage
		const cost = estimateCost(
			modelId,
			result.usage.inputTokens ?? 0,
			result.usage.outputTokens ?? 0,
		);

		// Update execution to success
		db.update(executionHistory)
			.set({
				status: "success",
				result: output,
				inputTokens: result.usage.inputTokens ?? null,
				outputTokens: result.usage.outputTokens ?? null,
				estimatedCost: cost,
				durationMs,
				completedAt: new Date().toISOString(),
			})
			.where(eq(executionHistory.id, executionId))
			.run();

		// --- Notification (fire-and-forget, never affects execution status) ---
		try {
			// Set delivery status to pending before send attempt
			db.update(executionHistory)
				.set({ deliveryStatus: "pending" })
				.where(eq(executionHistory.id, executionId))
				.run();

			const notifyResult = await sendNotification(agent.name, new Date().toISOString(), output);

			if (notifyResult.status === "skipped") {
				// Reset pending back to null when notification is not configured
				db.update(executionHistory)
					.set({ deliveryStatus: null })
					.where(eq(executionHistory.id, executionId))
					.run();
			} else {
				db.update(executionHistory)
					.set({ deliveryStatus: notifyResult.status === "sent" ? "sent" : "failed" })
					.where(eq(executionHistory.id, executionId))
					.run();
			}
		} catch (err) {
			// Never let notification errors affect execution status
			console.error(`[notify] Unexpected error: ${err}`);
			db.update(executionHistory)
				.set({ deliveryStatus: "failed" })
				.where(eq(executionHistory.id, executionId))
				.run();
		}

		return { status: "success", executionId, output };
	} catch (error) {
		const durationMs = Date.now() - startTime;
		const isCircuitOpen = error instanceof CircuitBreakerOpenError;
		const errorMsg = isCircuitOpen
			? "Circuit breaker open - call rejected"
			: error instanceof Error
				? error.message
				: String(error);

		// Update execution to failure
		db.update(executionHistory)
			.set({
				status: "failure",
				error: errorMsg,
				estimatedCost: isCircuitOpen ? 0 : null,
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
