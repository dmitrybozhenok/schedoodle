import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema.js";
import { markRunningAsShutdownTimeout } from "../src/services/startup.js";

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

describe("shutdown", () => {
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

	describe("markRunningAsShutdownTimeout", () => {
		it("marks all running records as failure with 'Shutdown timeout exceeded'", () => {
			const agent = db
				.insert(schema.agents)
				.values({
					name: "RunningAgent",
					taskDescription: "Still running",
					cronSchedule: "0 * * * *",
				})
				.returning()
				.get();

			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "running" })
				.run();
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "running" })
				.run();

			const count = markRunningAsShutdownTimeout(db);
			expect(count).toBe(2);

			const rows = db.select().from(schema.executionHistory).all();
			for (const row of rows) {
				expect(row.status).toBe("failure");
				expect(row.error).toBe("Shutdown timeout exceeded");
			}
		});

		it("sets completedAt and returns count of affected rows", () => {
			const agent = db
				.insert(schema.agents)
				.values({
					name: "TimedOut",
					taskDescription: "Timed out",
					cronSchedule: "0 * * * *",
				})
				.returning()
				.get();

			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "running" })
				.run();

			const count = markRunningAsShutdownTimeout(db);
			expect(count).toBe(1);

			const rows = db.select().from(schema.executionHistory).all();
			expect(rows[0].completedAt).toBeTruthy();
		});

		it("returns 0 when no running records exist", () => {
			const count = markRunningAsShutdownTimeout(db);
			expect(count).toBe(0);
		});

		it("does not affect success records", () => {
			const agent = db
				.insert(schema.agents)
				.values({
					name: "SuccessAgent",
					taskDescription: "Already done",
					cronSchedule: "0 * * * *",
				})
				.returning()
				.get();

			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "success",
					result: JSON.stringify({ summary: "done" }),
				})
				.run();

			const count = markRunningAsShutdownTimeout(db);
			expect(count).toBe(0);

			const rows = db.select().from(schema.executionHistory).all();
			expect(rows[0].status).toBe("success");
			expect(rows[0].error).toBeNull();
		});
	});
});
