import {
	CIRCUIT_BREAKER_FAILURE_THRESHOLD,
	CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
} from "../config/constants.js";
import { env } from "../config/env.js";
import type { Database } from "../db/index.js";
import { log } from "../helpers/logger.js";
import type { Agent } from "../types/index.js";
import { createCircuitBreaker } from "./circuit-breaker.js";
import { executeAgentCore } from "./execution-orchestrator.js";
import { createSemaphore, type SemaphoreStatus } from "./semaphore.js";

// Re-export types for consumers
export type { ExecuteResult } from "./execution-orchestrator.js";

const BREAKER_NAME = env.LLM_PROVIDER === "ollama" ? "ollama" : "anthropic";

let llmBreaker = createCircuitBreaker({
	name: BREAKER_NAME,
	failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
	resetTimeoutMs: CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
});

/**
 * Reset the LLM circuit breaker. Intended for test isolation only.
 */
export function _resetLlmBreaker() {
	llmBreaker = createCircuitBreaker({
		name: BREAKER_NAME,
		failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
		resetTimeoutMs: CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
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

/**
 * Get the current circuit breaker status for the LLM provider.
 * Useful for health endpoints.
 */
export function getLlmCircuitStatus() {
	return llmBreaker.getStatus();
}

/**
 * Execute a single agent: prefetch URLs, call LLM, record result in DB.
 */
async function executeAgentInner(agent: Agent, db: Database) {
	return executeAgentCore(agent, db, llmBreaker);
}

/**
 * Execute a single agent with concurrency limiting via semaphore.
 * Wraps executeAgentInner with acquire/release to enforce MAX_CONCURRENT_LLM.
 */
export async function executeAgent(agent: Agent, db: Database) {
	const status = llmSemaphore.getStatus();
	if (status.active >= status.limit) {
		log.concurrency.info(
			`Slot full (${status.active}/${status.limit} active), agent "${agent.name}" queued`,
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
): Promise<PromiseSettledResult<import("./execution-orchestrator.js").ExecuteResult>[]> {
	return Promise.allSettled(agents.map((a) => executeAgent(a, db)));
}
