import { type Tool as AiTool, generateText, NoObjectGeneratedError, Output, stepCountIs } from "ai";
import { eq, inArray } from "drizzle-orm";
import { DEFAULT_EXECUTION_TIMEOUT_MS } from "../config/constants.js";
import { DEFAULT_MODEL, resolveModel } from "../config/llm-provider.js";
import { estimateCost } from "../config/pricing.js";
import type { Database } from "../db/index.js";
import { agentTools, tools } from "../db/schema.js";
import type { AgentOutput } from "../schemas/agent-output.js";
import { agentOutputSchema } from "../schemas/agent-output.js";
import { buildPrompt, prefetchUrls } from "../services/prefetch.js";
import type { Agent } from "../types/index.js";
import { CircuitBreakerOpenError } from "./circuit-breaker.js";
import { insertRunningRecord, recordFailure, recordSuccess } from "./execution-recorder.js";
import { dispatchNotifications } from "./notifier.js";
import { buildToolSet } from "./tools/registry.js";

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

// biome-ignore lint/suspicious/noExplicitAny: AI SDK tools have heterogeneous input types
type AnyTool = AiTool<any, any>;

type ToolCallLogEntry = {
	toolName: string;
	input: unknown;
	output: string;
	durationMs: number;
};

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 */
function truncate(str: string, maxLen: number): string {
	return str.length > maxLen ? `${str.slice(0, maxLen)}...` : str;
}

/**
 * Call the LLM with structured output and one retry on validation failure.
 * Accepts a tool set and abort signal for multi-step tool calling.
 */
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
 * Core execution logic: prefetch URLs, load tools, call LLM, record result, dispatch notifications.
 * Receives the circuit breaker as a parameter for testability (no module-level singletons).
 */
export async function executeAgentCore(
	agent: Agent,
	db: Database,
	breaker: { execute: <T>(action: () => Promise<T>) => Promise<T> },
): Promise<ExecuteResult> {
	const inserted = insertRunningRecord(agent.id, db);
	const executionId = inserted.id;
	const startTime = Date.now();

	const timeoutMs = agent.maxExecutionMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
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
		const { result, retryCount, toolCallLog } = await breaker.execute(() =>
			callLlmWithRetry(modelId, agent.systemPrompt, userMessage, toolSet, controller.signal),
		);

		const durationMs = Date.now() - startTime;
		const output = result.output as AgentOutput;

		// Prefer totalUsage (aggregates across multi-step tool calls) over usage
		const usage = result.totalUsage ?? result.usage;

		// Compute estimated cost from token usage
		const cost = estimateCost(modelId, usage.inputTokens ?? 0, usage.outputTokens ?? 0);

		// Record success in DB
		recordSuccess(executionId, db, {
			result: output,
			inputTokens: usage.inputTokens ?? null,
			outputTokens: usage.outputTokens ?? null,
			estimatedCost: cost,
			retryCount,
			durationMs,
			toolCalls: toolCallLog.length > 0 ? toolCallLog : null,
		});

		// Notification (fire-and-forget)
		await dispatchNotifications(
			{ type: "success", agentName: agent.name, executedAt: new Date().toISOString(), output },
			executionId,
			db,
		);

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

		// Record failure in DB
		recordFailure(executionId, db, {
			error: errorMsg,
			estimatedCost: isCircuitOpen ? 0 : null,
			retryCount: 0,
			durationMs,
		});

		// Failure notification (fire-and-forget)
		await dispatchNotifications(
			{ type: "failure", agentName: agent.name, executedAt: new Date().toISOString(), errorMsg },
			executionId,
			db,
		);

		return { status: "failure", executionId, error: errorMsg };
	} finally {
		clearTimeout(timeout);
	}
}
