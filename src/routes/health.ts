import type { Cron } from "croner";
import { count, desc, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import type { Database } from "../db/index.js";
import { agents, executionHistory } from "../db/schema.js";
import { getConsecutiveFailures } from "../helpers/enrich-agent.js";
import type { CircuitBreakerStatus } from "../services/circuit-breaker.js";
import type { SemaphoreStatus } from "../services/semaphore.js";

/**
 * Truncate a value to maxLength characters. Returns null if value is null/undefined.
 * Appends "..." if truncated.
 */
function truncate(value: unknown, maxLength = 200): string | null {
	if (value === null || value === undefined) return null;
	const str = typeof value === "string" ? value : JSON.stringify(value);
	if (str.length <= maxLength) return str;
	return `${str.slice(0, maxLength)}...`;
}

/**
 * Factory function to create the health check route.
 * Returns a Hono sub-app mounted at /health.
 */
export function createHealthRoute(
	db: Database,
	getCircuitStatus: () => CircuitBreakerStatus,
	startedAt: number,
	getScheduledJobs: () => Map<number, Cron>,
	getConcurrencyStatus: () => SemaphoreStatus,
	isShuttingDown: () => boolean,
): Hono {
	const app = new Hono();

	app.get("/", (c) => {
		if (isShuttingDown()) {
			return c.json(
				{
					status: "shutting_down",
					shutting_down: true,
					concurrency: getConcurrencyStatus(),
				},
				503,
			);
		}

		const uptimeMs = Date.now() - startedAt;

		// Count agents
		const agentRow = db.select({ count: count() }).from(agents).get();
		const agentCount = agentRow?.count ?? 0;

		// Fetch all agents
		const allAgents = db.select().from(agents).all();

		// Query recent executions (last 24 hours)
		const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		const recentRows = db
			.select()
			.from(executionHistory)
			.where(gte(executionHistory.startedAt, twentyFourHoursAgo))
			.all();

		// Group 24h executions by agentId
		const execsByAgent = new Map<number, typeof recentRows>();
		for (const row of recentRows) {
			if (row.agentId === null) continue;
			const existing = execsByAgent.get(row.agentId);
			if (existing) {
				existing.push(row);
			} else {
				execsByAgent.set(row.agentId, [row]);
			}
		}

		// --- A. Per-agent stats ---
		const agentStats = allAgents.map((agent) => {
			// Most recent execution (any time) for this agent
			const lastExec = db
				.select({
					startedAt: executionHistory.startedAt,
					status: executionHistory.status,
					result: executionHistory.result,
					error: executionHistory.error,
				})
				.from(executionHistory)
				.where(eq(executionHistory.agentId, agent.id))
				.orderBy(desc(executionHistory.startedAt))
				.limit(1)
				.get();

			const lastRunAt = lastExec?.startedAt ?? null;
			const lastStatus = lastExec?.status ?? null;
			const lastResult = truncate(lastExec?.result);
			const lastError = truncate(lastExec?.error);

			// 24h window stats
			const agentExecs = execsByAgent.get(agent.id) ?? [];
			const completed = agentExecs.filter((e) => e.status !== "running");
			const successCount = completed.filter((e) => e.status === "success").length;
			const successRate = completed.length > 0 ? (successCount / completed.length) * 100 : 100;

			const durValues = agentExecs
				.filter((e) => e.durationMs !== null)
				.map((e) => e.durationMs as number);
			const avgDurationMs =
				durValues.length > 0 ? durValues.reduce((a, b) => a + b, 0) / durValues.length : 0;

			// Health flags
			const consecutiveFailures = getConsecutiveFailures(agent.id, db);
			const healthy = consecutiveFailures < 3;

			return {
				agentId: agent.id,
				agentName: agent.name,
				lastRunAt,
				lastStatus,
				lastResult,
				lastError,
				successRate: Math.round(successRate * 100) / 100,
				avgDurationMs: Math.round(avgDurationMs),
				healthy,
				consecutiveFailures,
			};
		});

		// --- B. Per-channel delivery stats (24h window) ---
		let emailSent = 0;
		let emailFailed = 0;
		let telegramSent = 0;
		let telegramFailed = 0;
		for (const row of recentRows) {
			if (row.emailDeliveryStatus === "sent") emailSent++;
			else if (row.emailDeliveryStatus === "failed") emailFailed++;
			if (row.telegramDeliveryStatus === "sent") telegramSent++;
			else if (row.telegramDeliveryStatus === "failed") telegramFailed++;
		}

		// --- C. System-wide aggregates ---
		let success = 0;
		let failure = 0;
		const allDurations: number[] = [];
		for (const row of recentRows) {
			if (row.status === "success") success++;
			else if (row.status === "failure") failure++;
			if (row.durationMs !== null) allDurations.push(row.durationMs);
		}
		const completedTotal = success + failure;
		const systemSuccessRate =
			completedTotal > 0 ? Math.round((success / completedTotal) * 100 * 100) / 100 : 100;
		const systemAvgDurationMs =
			allDurations.length > 0
				? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length)
				: 0;

		// --- D. Upcoming runs ---
		const scheduledJobs = getScheduledJobs();
		const agentNameLookup = new Map<number, string>();
		for (const agent of allAgents) {
			agentNameLookup.set(agent.id, agent.name);
		}

		const upcomingRuns: Array<{ agentName: string; scheduledAt: string }> = [];
		for (const [agentId, job] of scheduledJobs) {
			const nextRun = job.nextRun();
			if (nextRun) {
				const name = agentNameLookup.get(agentId) ?? `Agent ${agentId}`;
				upcomingRuns.push({ agentName: name, scheduledAt: nextRun.toISOString() });
			}
		}
		upcomingRuns.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
		const limitedUpcomingRuns = upcomingRuns.slice(0, 5);

		// --- E. Top-level status ---
		const circuitBreaker = getCircuitStatus();
		let status: "ok" | "degraded" | "unhealthy";
		if (circuitBreaker.state === "OPEN") {
			status = "unhealthy";
		} else if (agentStats.length === 0) {
			status = "ok";
		} else {
			const unhealthyCount = agentStats.filter((a) => !a.healthy).length;
			if (unhealthyCount === 0) {
				status = "ok";
			} else if (unhealthyCount > agentStats.length / 2) {
				status = "unhealthy";
			} else {
				status = "degraded";
			}
		}

		// --- F. Build response ---
		return c.json({
			status,
			shutting_down: false,
			uptimeMs,
			agentCount,
			circuitBreaker,
			concurrency: getConcurrencyStatus(),
			recentExecutions: {
				success,
				failure,
				total: recentRows.length,
				successRate: systemSuccessRate,
				avgDurationMs: systemAvgDurationMs,
			},
			deliveryStats: {
				email: { sent: emailSent, failed: emailFailed },
				telegram: { sent: telegramSent, failed: telegramFailed },
			},
			agents: agentStats,
			upcomingRuns: limitedUpcomingRuns,
		});
	});

	return app;
}
