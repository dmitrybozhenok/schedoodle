import { eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { executionHistory } from "../db/schema.js";

/**
 * Insert a new 'running' execution record. Returns the inserted row (with id).
 */
export function insertRunningRecord(agentId: number, db: Database) {
	return db.insert(executionHistory).values({ agentId, status: "running" }).returning().get();
}

/**
 * Update an execution record to 'success' with all metrics.
 */
export function recordSuccess(
	executionId: number,
	db: Database,
	data: {
		result: unknown;
		inputTokens: number | null;
		outputTokens: number | null;
		estimatedCost: number;
		retryCount: number;
		durationMs: number;
		toolCalls: unknown[] | null;
	},
) {
	db.update(executionHistory)
		.set({
			status: "success",
			result: data.result,
			inputTokens: data.inputTokens,
			outputTokens: data.outputTokens,
			estimatedCost: data.estimatedCost,
			retryCount: data.retryCount,
			durationMs: data.durationMs,
			toolCalls: data.toolCalls,
			completedAt: new Date().toISOString(),
		})
		.where(eq(executionHistory.id, executionId))
		.run();
}

/**
 * Update an execution record to 'failure' with error details.
 */
export function recordFailure(
	executionId: number,
	db: Database,
	data: {
		error: string;
		estimatedCost: number | null;
		retryCount: number;
		durationMs: number;
	},
) {
	db.update(executionHistory)
		.set({
			status: "failure",
			error: data.error,
			estimatedCost: data.estimatedCost,
			retryCount: data.retryCount,
			durationMs: data.durationMs,
			completedAt: new Date().toISOString(),
		})
		.where(eq(executionHistory.id, executionId))
		.run();
}
