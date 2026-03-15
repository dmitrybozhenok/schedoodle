import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema.js";
import {
	cleanupStaleExecutions,
	pruneOldExecutions,
} from "../src/services/startup.js";

const CREATE_AGENTS_SQL = `
CREATE TABLE agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  task_description TEXT NOT NULL,
  cron_schedule TEXT NOT NULL,
  system_prompt TEXT,
  model TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  max_execution_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE UNIQUE INDEX agents_name_nocase ON agents(name COLLATE NOCASE);
`;

const CREATE_EXECUTION_HISTORY_SQL = `
CREATE TABLE execution_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'failure', 'running')),
  input_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,
  result TEXT,
  error TEXT,
  delivery_status TEXT,
  estimated_cost REAL,
  retry_count INTEGER DEFAULT 0,
  tool_calls TEXT,
  started_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  completed_at TEXT
);
CREATE INDEX idx_exec_agent_id ON execution_history(agent_id);
CREATE INDEX idx_exec_agent_started ON execution_history(agent_id, started_at);
CREATE INDEX idx_exec_status ON execution_history(status);
`;

describe("startup tasks", () => {
	let sqlite: Database.Database;
	let db: ReturnType<typeof drizzle>;

	beforeEach(() => {
		sqlite = new Database(":memory:");
		sqlite.pragma("foreign_keys = ON");
		sqlite.exec(CREATE_AGENTS_SQL);
		sqlite.exec(CREATE_EXECUTION_HISTORY_SQL);
		db = drizzle(sqlite, { schema });
	});

	afterEach(() => {
		sqlite.close();
	});

	describe("cleanupStaleExecutions", () => {
		it("marks running records as failure", () => {
			// Insert an agent
			const agent = db
				.insert(schema.agents)
				.values({
					name: "StaleAgent",
					taskDescription: "Goes stale",
					cronSchedule: "0 * * * *",
				})
				.returning()
				.get();

			// Insert a running execution
			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "running",
				})
				.run();

			const count = cleanupStaleExecutions(db);
			expect(count).toBe(1);

			// Verify the record was updated
			const rows = db.select().from(schema.executionHistory).all();
			expect(rows).toHaveLength(1);
			expect(rows[0].status).toBe("failure");
			expect(rows[0].error).toBe("Process terminated during execution");
			expect(rows[0].completedAt).toBeTruthy();
			expect(rows[0].durationMs).toBeNull();
		});

		it("returns 0 when no stale records exist", () => {
			const count = cleanupStaleExecutions(db);
			expect(count).toBe(0);
		});

		it("does not affect non-running records", () => {
			const agent = db
				.insert(schema.agents)
				.values({
					name: "FinishedAgent",
					taskDescription: "Already done",
					cronSchedule: "0 * * * *",
				})
				.returning()
				.get();

			// Insert success and failure executions
			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "success",
					result: { summary: "done" },
				})
				.run();
			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "failure",
					error: "Actual error",
				})
				.run();

			const count = cleanupStaleExecutions(db);
			expect(count).toBe(0);

			// Verify records unchanged
			const rows = db.select().from(schema.executionHistory).all();
			expect(rows).toHaveLength(2);
			expect(rows[0].status).toBe("success");
			expect(rows[1].status).toBe("failure");
			expect(rows[1].error).toBe("Actual error");
		});
	});

	describe("pruneOldExecutions", () => {
		it("deletes old records beyond retention window", () => {
			const agent = db
				.insert(schema.agents)
				.values({
					name: "PruneAgent",
					taskDescription: "Gets pruned",
					cronSchedule: "0 * * * *",
				})
				.returning()
				.get();

			// Insert an old execution (60 days ago)
			const oldDate = new Date(
				Date.now() - 60 * 24 * 60 * 60 * 1000,
			).toISOString();
			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "success",
					startedAt: oldDate,
				})
				.run();

			// Insert a recent execution (10 days ago)
			const recentDate = new Date(
				Date.now() - 10 * 24 * 60 * 60 * 1000,
			).toISOString();
			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "success",
					startedAt: recentDate,
				})
				.run();

			const count = pruneOldExecutions(db, 30);
			expect(count).toBe(1);

			// Verify only the recent record remains
			const rows = db.select().from(schema.executionHistory).all();
			expect(rows).toHaveLength(1);
			expect(rows[0].startedAt).toBe(recentDate);
		});

		it("returns 0 when no old records exist", () => {
			const agent = db
				.insert(schema.agents)
				.values({
					name: "RecentAgent",
					taskDescription: "All recent",
					cronSchedule: "0 * * * *",
				})
				.returning()
				.get();

			// Insert only recent records
			const recentDate = new Date(
				Date.now() - 5 * 24 * 60 * 60 * 1000,
			).toISOString();
			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "success",
					startedAt: recentDate,
				})
				.run();

			const count = pruneOldExecutions(db, 30);
			expect(count).toBe(0);
		});
	});
});
