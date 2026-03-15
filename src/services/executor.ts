import { type Tool as AiTool, generateText, NoObjectGeneratedError, Output, stepCountIs } from "ai";
import { eq, inArray } from "drizzle-orm";
import { env } from "../config/env.js";
import { DEFAULT_MODEL, resolveModel } from "../config/llm-provider.js";
import { estimateCost } from "../config/pricing.js";
import type { Database } from "../db/index.js";
import { agentTools, executionHistory, tools } from "../db/schema.js";
import type { AgentOutput } from "../schemas/agent-output.js";
import { agentOutputSchema } from "../schemas/agent-output.js";
import { buildPrompt, prefetchUrls } from "../services/prefetch.js";
import type { Agent } from "../types/index.js";
import { CircuitBreakerOpenError, createCircuitBreaker } from "./circuit-breaker.js";
import { sendFailureNotification, sendNotification } from "./notifier.js";
import { createSemaphore, type SemaphoreStatus } from "./semaphore.js";
import { buildToolSet } from "./tools/registry.js";

const BREAKER_NAME = env.LLM_PROVIDER === "ollama" ? "ollama" : "anthropic";

let llmBreaker = createCircuitBreaker({
	name: BREAKER_NAME,
	failureThreshold: 3,
	resetTimeoutMs: 30_000,
});

/**
 * Reset the LLM circuit breaker. Intended for test isolation only.
 */
export function _resetLlmBreaker() {
	llmBreaker = createCircuitBreaker({
		name: BREAKER_NAME,
		failureThreshold: 3,
		resetTimeoutMs: 30_000,
	});
}

let llmSemaphore = createSemaphore(env.MAX_CONCURRENT_LLM);

/**
 * Get the current LLM concurrency semaphore status.
 */
export function getLlmSemaphoreStatus(): SemaphoreStatus {
	return llmSemaphore.getStatus();
}

/**
 * Drain queued LLM executions. Returns the count of dropped waiters.
 */
export function drainLlmSemaphore(): number {
	return llmSemaphore.drain();
}

/**
 * Reset the LLM semaphore. Intended for test isolation only.
 */
export function _resetLlmSemaphore(): void {
	llmSemaphore = createSemaphore(env.MAX_CONCURRENT_LLM);
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
 * Truncate a string to maxLen characters, appending "..." if truncated.
 */
function truncate(str: string, maxLen: number): string {
	return str.length > maxLen ? `${str.slice(0, maxLen)}...` : str;
}

type ToolCallLogEntry = {
	toolName: string;
	input: unknown;
	output: string;
	durationMs: number;
};

/**
 * Call the LLM with structured output and one retry on validation failure.
 * Accepts a tool set and abort signal for multi-step tool calling.
 */
// biome-ignore lint/suspicious/noExplicitAny: AI SDK tools have heterogeneous input types
type AnyTool = AiTool<any, any>;

async function callLlmWithRetry(
	modelId: string,
	systemPrompt: string | null,
	userMessage: string,
	toolSet: Record<string, AnyTool>,
	abortSignal: AbortSignal,
) {
	const model = await resolveModel(modelId);
	const hasTools = Object.keys(toolSet).length > 0;

	const toolCallLog: ToolCallLogEntry[] = [];

	// biome-ignore lint/suspicious/noExplicitAny: AI SDK step events have complex generic types
	const onStepFinish = (event: any) => {
		const toolCalls = event.toolCalls as Array<{ toolName: string; args: unknown }> | undefined;
		const toolResults = event.toolResults as Array<{ result?: unknown }> | undefined;
		if (toolCalls) {
			for (let i = 0; i < toolCalls.length; i++) {
				toolCallLog.push({
					toolName: toolCalls[i].toolName,
					input: toolCalls[i].args,
					output: truncate(String(toolResults?.[i]?.result ?? ""), 2000),
					durationMs: 0,
				});
			}
		}
	};

	const callGenerateText = (prompt: string) =>
		generateText({
			model,
			system: systemPrompt ?? undefined,
			output: Output.object({ schema: agentOutputSchema }),
			tools: hasTools ? toolSet : undefined,
			stopWhen: hasTools ? stepCountIs(10) : undefined,
			abortSignal,
			onStepFinish,
			prompt,
		});

	try {
		const result = await callGenerateText(userMessage);
		return { result, retryCount: 0, toolCallLog };
	} catch (error) {
		if (NoObjectGeneratedError.isInstance(error)) {
			// Retry once with validation error appended as feedback
			const errorMsg = error instanceof Error ? error.message : String(error);
			const retryPrompt = `${userMessage}\n\n[Previous attempt failed validation: ${errorMsg}]\nPlease provide a valid response matching the required schema.`;

			const result = await callGenerateText(retryPrompt);
			return { result, retryCount: 1, toolCallLog };
		}
		throw error;
	}
}

/**
 * Execute a single agent: prefetch URLs, call LLM, record result in DB.
 */
async function executeAgentInner(agent: Agent, db: Database): Promise<ExecuteResult> {
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

	// Create AbortController with per-agent timeout
	const timeoutMs = agent.maxExecutionMs ?? 60_000;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		// Prefetch URLs from task description
		const contextData = await prefetchUrls(agent.taskDescription);
		const userMessage = buildPrompt(agent.taskDescription, contextData);

		// Load custom tools for this agent from DB
		const agentToolLinks = db
			.select({ toolId: agentTools.toolId })
			.from(agentTools)
			.where(eq(agentTools.agentId, agent.id))
			.all();
		const customTools =
			agentToolLinks.length > 0
				? db
						.select()
						.from(tools)
						.where(
							inArray(
								tools.id,
								agentToolLinks.map((l) => l.toolId),
							),
						)
						.all()
				: [];
		const toolSet = buildToolSet(customTools);

		// Call LLM with retry, wrapped in circuit breaker
		const modelId = agent.model ?? DEFAULT_MODEL;
		const { result, retryCount, toolCallLog } = await llmBreaker.execute(() =>
			callLlmWithRetry(modelId, agent.systemPrompt, userMessage, toolSet, controller.signal),
		);

		const durationMs = Date.now() - startTime;
		const output = result.output as AgentOutput;

		// Prefer totalUsage (aggregates across multi-step tool calls) over usage
		const usage = result.totalUsage ?? result.usage;

		// Compute estimated cost from token usage
		const cost = estimateCost(modelId, usage.inputTokens ?? 0, usage.outputTokens ?? 0);

		// Update execution to success
		db.update(executionHistory)
			.set({
				status: "success",
				result: output,
				inputTokens: usage.inputTokens ?? null,
				outputTokens: usage.outputTokens ?? null,
				estimatedCost: cost,
				retryCount,
				durationMs,
				toolCalls: toolCallLog.length > 0 ? toolCallLog : null,
				completedAt: new Date().toISOString(),
			})
			.where(eq(executionHistory.id, executionId))
			.run();

		// --- Notification (fire-and-forget, never affects execution status) ---
		try {
			// Set delivery status to pending before send attempt
			db.update(executionHistory)
				.set({ emailDeliveryStatus: "pending" })
				.where(eq(executionHistory.id, executionId))
				.run();

			const notifyResult = await sendNotification(agent.name, new Date().toISOString(), output);

			if (notifyResult.status === "skipped") {
				// Reset pending back to null when notification is not configured
				db.update(executionHistory)
					.set({ emailDeliveryStatus: null })
					.where(eq(executionHistory.id, executionId))
					.run();
			} else {
				db.update(executionHistory)
					.set({ emailDeliveryStatus: notifyResult.status === "sent" ? "sent" : "failed" })
					.where(eq(executionHistory.id, executionId))
					.run();
			}
		} catch (err) {
			// Never let notification errors affect execution status
			console.error(`[notify] Unexpected error: ${err}`);
			db.update(executionHistory)
				.set({ emailDeliveryStatus: "failed" })
				.where(eq(executionHistory.id, executionId))
				.run();
		}

		return { status: "success", executionId, output };
	} catch (error) {
		const durationMs = Date.now() - startTime;
		const isCircuitOpen = error instanceof CircuitBreakerOpenError;
		const isAbort = error instanceof Error && error.name === "AbortError";
		const errorMsg = isAbort
			? `Execution timed out after ${timeoutMs}ms`
			: isCircuitOpen
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
				retryCount: 0,
				durationMs,
				completedAt: new Date().toISOString(),
			})
			.where(eq(executionHistory.id, executionId))
			.run();

		// --- Failure notification (fire-and-forget) ---
		try {
			const notifyResult = await sendFailureNotification(
				agent.name,
				new Date().toISOString(),
				errorMsg,
			);
			if (notifyResult.status !== "skipped") {
				db.update(executionHistory)
					.set({ emailDeliveryStatus: notifyResult.status === "sent" ? "sent" : "failed" })
					.where(eq(executionHistory.id, executionId))
					.run();
			}
		} catch (err) {
			console.error(`[notify] Unexpected error on failure notification: ${err}`);
			db.update(executionHistory)
				.set({ emailDeliveryStatus: "failed" })
				.where(eq(executionHistory.id, executionId))
				.run();
		}

		return { status: "failure", executionId, error: errorMsg };
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Execute a single agent with concurrency limiting via semaphore.
 * Wraps executeAgentInner with acquire/release to enforce MAX_CONCURRENT_LLM.
 */
export async function executeAgent(agent: Agent, db: Database): Promise<ExecuteResult> {
	const status = llmSemaphore.getStatus();
	if (status.active >= status.limit) {
		console.log(
			`[concurrency] Slot full (${status.active}/${status.limit} active), agent "${agent.name}" queued`,
		);
	}
	await llmSemaphore.acquire();
	try {
		return await executeAgentInner(agent, db);
	} finally {
		llmSemaphore.release();
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
