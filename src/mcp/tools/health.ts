import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { desc, eq, gte } from "drizzle-orm";
import type { Database } from "../../db/index.js";
import { agents, executionHistory } from "../../db/schema.js";
import { getConsecutiveFailures } from "../../helpers/enrich-agent.js";
import { getLlmCircuitStatus, getLlmSemaphoreStatus } from "../../services/executor.js";
import { jsonResponse } from "../helpers.js";

/**
 * Register health check MCP tools on the server.
 * Tools: get_health
 */
export function registerHealthTools(server: McpServer, db: Database): void {
	server.registerTool(
		"get_health",
		{
			title: "Get Health",
			description:
				"Get system health status including agent breakdown, circuit breaker state, and execution statistics.",
			inputSchema: z.object({}),
		},
		async () => {
			// Count agents
			const allAgents = db.select().from(agents).all();
			const agentCount = allAgents.length;

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

			// Per-agent stats
			const agentStats = allAgents.map((agent) => {
				// Most recent execution for this agent
				const lastExec = db
					.select({
						startedAt: executionHistory.startedAt,
						status: executionHistory.status,
					})
					.from(executionHistory)
					.where(eq(executionHistory.agentId, agent.id))
					.orderBy(desc(executionHistory.startedAt))
					.limit(1)
					.get();

				const lastRunAt = lastExec?.startedAt ?? null;
				const lastStatus = lastExec?.status ?? null;

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
					successRate: Math.round(successRate * 100) / 100,
					avgDurationMs: Math.round(avgDurationMs),
					healthy,
					consecutiveFailures,
				};
			});

			// System-wide aggregates
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

			// Circuit breaker and concurrency
			const circuitBreaker = getLlmCircuitStatus();
			const concurrency = getLlmSemaphoreStatus();

			// Top-level status
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

			return jsonResponse({
				status,
				agentCount,
				circuitBreaker,
				concurrency,
				recentExecutions: {
					success,
					failure,
					total: recentRows.length,
					successRate: systemSuccessRate,
					avgDurationMs: systemAvgDurationMs,
				},
				agents: agentStats,
				upcomingRuns: "Not available from MCP server (scheduler runs in HTTP server process)",
			});
		},
	);
}
