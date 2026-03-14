import { Cron } from "croner";
import { desc, eq } from "drizzle-orm";
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
 * Enrich a raw agent DB row with computed fields for API responses.
 * Converts integer enabled to boolean, adds nextRunAt and lastRunAt.
 */
export function enrichAgent(agent: Agent, db: Database): AgentResponse {
	return {
		...agent,
		enabled: Boolean(agent.enabled),
		nextRunAt: getNextRunAt(agent),
		lastRunAt: getLastRunAt(agent.id, db),
	};
}
