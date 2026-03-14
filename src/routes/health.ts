import { Hono } from "hono";
import { gte, count } from "drizzle-orm";
import { agents, executionHistory } from "../db/schema.js";
import type { CircuitBreakerStatus } from "../services/circuit-breaker.js";
import type { Database } from "../db/index.js";

/**
 * Factory function to create the health check route.
 * Returns a Hono sub-app mounted at /health.
 */
export function createHealthRoute(
	db: Database,
	getCircuitStatus: () => CircuitBreakerStatus,
	startedAt: number,
): Hono {
	const app = new Hono();

	app.get("/", (c) => {
		const uptimeMs = Date.now() - startedAt;

		// Count agents
		const agentRow = db.select({ count: count() }).from(agents).get();
		const agentCount = agentRow?.count ?? 0;

		// Query recent executions (last 24 hours)
		const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		const recentRows = db
			.select({ status: executionHistory.status })
			.from(executionHistory)
			.where(gte(executionHistory.startedAt, twentyFourHoursAgo))
			.all();

		let success = 0;
		let failure = 0;
		for (const row of recentRows) {
			if (row.status === "success") success++;
			else if (row.status === "failure") failure++;
		}

		const circuitBreaker = getCircuitStatus();

		return c.json({
			status: "ok",
			uptimeMs,
			agentCount,
			circuitBreaker,
			recentExecutions: {
				success,
				failure,
				total: recentRows.length,
			},
		});
	});

	return app;
}
