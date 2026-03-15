import { Cron } from "croner";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { executionHistory } from "../db/schema.js";
import type { Agent, AgentResponse } from "../types/index.js";

/**
 * Compute the next scheduled run time for an agent.
 * Returns null if the agent is disabled.
 * Creates a temporary paused Cron instance, calls nextRun(), and stops it to avoid leaks.
 */
export function getNextRunAt(agent: Pick<Agent, "cronSchedule" | "enabled">): string | null {
	if (!agent.enabled) return null;
	const job = new Cron(agent.cronSchedule, { paused: true });
	const next = job.nextRun();
	job.stop();
	return next ? next.toISOString() : null;
}

/**
 * Get the most recent execution start time for an agent.
 * Returns null if no executions exist.
 */
export function getLastRunAt(agentId: number, db: Database): string | null {
	const lastExec = db
		.select({ startedAt: executionHistory.startedAt })
		.from(executionHistory)
		.where(eq(executionHistory.agentId, agentId))
		.orderBy(desc(executionHistory.startedAt))
		.limit(1)
		.get();

	return lastExec?.startedAt ?? null;
}

/**
 * Count consecutive failures from the most recent executions (up to 3).
 * Excludes 'running' status rows. Returns 0 if no executions or first is success.
 */
export function getConsecutiveFailures(agentId: number, db: Database): number {
	const recent = db
		.select({ status: executionHistory.status })
		.from(executionHistory)
		.where(
			and(
				eq(executionHistory.agentId, agentId),
				inArray(executionHistory.status, ["success", "failure"]),
			),
		)
		.orderBy(desc(executionHistory.startedAt))
		.limit(3)
		.all();

	let count = 0;
	for (const row of recent) {
		if (row.status === "failure") {
			count++;
		} else {
			break;
		}
	}
	return count;
}

/**
 * Enrich a raw agent DB row with computed fields for API responses.
 * Converts integer enabled to boolean, adds nextRunAt, lastRunAt, healthy, and consecutiveFailures.
 */
export function enrichAgent(agent: Agent, db: Database): AgentResponse {
	const consecutiveFailures = getConsecutiveFailures(agent.id, db);
	return {
		...agent,
		enabled: Boolean(agent.enabled),
		nextRunAt: getNextRunAt(agent),
		lastRunAt: getLastRunAt(agent.id, db),
		healthy: consecutiveFailures < 3,
		consecutiveFailures,
	};
}
