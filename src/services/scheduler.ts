import { Cron } from "croner";
import { eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { agents } from "../db/schema.js";
import { executeAgent } from "../services/executor.js";
import type { Agent } from "../types/index.js";

const jobs = new Map<number, Cron>();

/**
 * Schedule a cron job for an agent. Replaces any existing job for the same agent ID.
 * On each trigger, re-reads the agent from DB to avoid stale closures.
 */
export function scheduleAgent(agent: Agent, db: Database): void {
	// Remove existing job if re-scheduling
	const existing = jobs.get(agent.id);
	if (existing) {
		existing.stop();
		jobs.delete(agent.id);
	}

	const agentId = agent.id;
	const agentName = agent.name;

	const job = new Cron(agent.cronSchedule, { name: `agent-${agentId}` }, async () => {
		// Re-read agent from DB to get fresh data
		const freshAgent = db.select().from(agents).where(eq(agents.id, agentId)).get();

		if (!freshAgent) {
			console.warn(`[cron] Agent ${agentName} (id=${agentId}) not found in DB, skipping execution`);
			return;
		}

		console.log(`[cron] Executing: ${freshAgent.name}`);
		const start = Date.now();

		try {
			const result = await executeAgent(freshAgent, db);
			const elapsed = ((Date.now() - start) / 1000).toFixed(1);
			console.log(`[cron] ${freshAgent.name}: ${result.status} in ${elapsed}s`);
		} catch (error) {
			const elapsed = ((Date.now() - start) / 1000).toFixed(1);
			const msg = error instanceof Error ? error.message : String(error);
			console.error(`[cron] ${freshAgent.name}: error in ${elapsed}s - ${msg}`);
		}
	});

	jobs.set(agentId, job);
}

/**
 * Remove and stop the cron job for a given agent ID. No-op if not found.
 */
export function removeAgent(agentId: number): void {
	const job = jobs.get(agentId);
	if (job) {
		job.stop();
		jobs.delete(agentId);
	}
}

/**
 * Schedule cron jobs for all provided agents.
 */
export function startAll(agentList: Agent[], db: Database): void {
	for (const agent of agentList) {
		scheduleAgent(agent, db);
	}
	console.log(`[cron] Scheduled ${agentList.length} agent(s)`);
}

/**
 * Stop all cron jobs and clear the registry.
 */
export function stopAll(): void {
	for (const job of jobs.values()) {
		job.stop();
	}
	jobs.clear();
}

/**
 * Get the number of active scheduled jobs. Useful for testing.
 */
export function getJobCount(): number {
	return jobs.size;
}
