import { eq, lt } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { executionHistory } from "../db/schema.js";

export function cleanupStaleExecutions(db: Database): number {
	const now = new Date().toISOString();
	const result = db
		.update(executionHistory)
		.set({
			status: "failure",
			error: "Process terminated during execution",
			completedAt: now,
		})
		.where(eq(executionHistory.status, "running"))
		.run();
	return result.changes;
}

export function markRunningAsShutdownTimeout(db: Database): number {
	const now = new Date().toISOString();
	const result = db
		.update(executionHistory)
		.set({
			status: "failure",
			error: "Shutdown timeout exceeded",
			completedAt: now,
		})
		.where(eq(executionHistory.status, "running"))
		.run();
	return result.changes;
}

export function pruneOldExecutions(
	db: Database,
	retentionDays: number,
): number {
	const cutoff = new Date(
		Date.now() - retentionDays * 24 * 60 * 60 * 1000,
	).toISOString();
	const result = db
		.delete(executionHistory)
		.where(lt(executionHistory.startedAt, cutoff))
		.run();
	return result.changes;
}
