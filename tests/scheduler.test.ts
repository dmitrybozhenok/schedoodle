import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema.js";

// Mock executeAgent from executor
const mockExecuteAgent = vi.fn();
vi.mock("../src/services/executor.js", () => ({
	executeAgent: (...args: unknown[]) => mockExecuteAgent(...args),
}));

import {
	getJobCount,
	removeAgent,
	scheduleAgent,
	startAll,
	stopAll,
} from "../src/services/scheduler.js";

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
  telegram_delivery_status TEXT,
  estimated_cost REAL,
  retry_count INTEGER DEFAULT 0,
  tool_calls TEXT,
  started_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  completed_at TEXT
);
`;

function makeAgent(
	db: ReturnType<typeof drizzle>,
	overrides: Partial<schema.agents.$inferInsert> = {},
) {
	return db
		.insert(schema.agents)
		.values({
			name: overrides.name ?? "TestAgent",
			taskDescription: overrides.taskDescription ?? "Do the thing",
			cronSchedule: overrides.cronSchedule ?? "* * * * * *",
			systemPrompt: overrides.systemPrompt ?? null,
			model: overrides.model ?? null,
			...overrides,
		})
		.returning()
		.get();
}

describe("scheduler", () => {
	let sqlite: Database.Database;
	let db: ReturnType<typeof drizzle>;

	beforeEach(() => {
		sqlite = new Database(":memory:");
		sqlite.exec(CREATE_AGENTS_SQL);
		sqlite.exec(CREATE_EXECUTION_HISTORY_SQL);
		db = drizzle(sqlite, { schema });

		vi.clearAllMocks();
		mockExecuteAgent.mockResolvedValue({
			status: "success",
			executionId: 1,
			output: { summary: "ok", details: "ok" },
		});
	});

	afterEach(() => {
		stopAll();
		sqlite.close();
	});

	describe("scheduleAgent", () => {
		it("registers a cron job that calls executeAgent", async () => {
			const agent = makeAgent(db, { cronSchedule: "* * * * * *" });
			scheduleAgent(agent, db);

			expect(getJobCount()).toBe(1);

			// Wait for cron to fire (every second pattern)
			await new Promise((r) => setTimeout(r, 1500));

			expect(mockExecuteAgent).toHaveBeenCalled();
			// Verify it re-read agent from DB (first arg should be an agent object)
			const calledAgent = mockExecuteAgent.mock.calls[0][0];
			expect(calledAgent.id).toBe(agent.id);
		});

		it("replaces existing job for same agent ID (no ghost jobs)", () => {
			const agent = makeAgent(db, { cronSchedule: "* * * * * *" });
			scheduleAgent(agent, db);
			scheduleAgent(agent, db);

			expect(getJobCount()).toBe(1);
		});
	});

	describe("removeAgent", () => {
		it("stops and removes the job for a given agent ID", () => {
			const agent = makeAgent(db, { cronSchedule: "* * * * * *" });
			scheduleAgent(agent, db);
			expect(getJobCount()).toBe(1);

			removeAgent(agent.id);
			expect(getJobCount()).toBe(0);
		});

		it("is a no-op for unknown agent IDs", () => {
			removeAgent(9999);
			expect(getJobCount()).toBe(0);
		});
	});

	describe("startAll", () => {
		it("schedules all provided agents", () => {
			const agent1 = makeAgent(db, { name: "Agent1", cronSchedule: "0 * * * *" });
			const agent2 = makeAgent(db, { name: "Agent2", cronSchedule: "0 * * * *" });

			startAll([agent1, agent2], db);
			expect(getJobCount()).toBe(2);
		});
	});

	describe("stopAll", () => {
		it("cancels all jobs and clears the registry", () => {
			const agent1 = makeAgent(db, { name: "Agent1", cronSchedule: "0 * * * *" });
			const agent2 = makeAgent(db, { name: "Agent2", cronSchedule: "0 * * * *" });

			startAll([agent1, agent2], db);
			expect(getJobCount()).toBe(2);

			stopAll();
			expect(getJobCount()).toBe(0);
		});
	});

	describe("re-schedule", () => {
		it("scheduleAgent same ID twice results in only one job", async () => {
			const agent = makeAgent(db, { cronSchedule: "* * * * * *" });
			scheduleAgent(agent, db);
			scheduleAgent(agent, db);

			expect(getJobCount()).toBe(1);

			await new Promise((r) => setTimeout(r, 1500));

			// Should not have double-fired from ghost job
			// With every-second cron, we expect 1-2 calls total, not 2-4
			expect(mockExecuteAgent.mock.calls.length).toBeLessThanOrEqual(2);
		});
	});

	describe("enabled/disabled behavior", () => {
		it("startAll only schedules enabled agents, skips disabled", () => {
			const enabled1 = makeAgent(db, { name: "Enabled1", cronSchedule: "0 * * * *", enabled: 1 });
			const enabled2 = makeAgent(db, { name: "Enabled2", cronSchedule: "0 * * * *", enabled: 1 });
			const disabled1 = makeAgent(db, { name: "Disabled1", cronSchedule: "0 * * * *", enabled: 0 });

			startAll([enabled1, enabled2, disabled1], db);
			expect(getJobCount()).toBe(2);
		});

		it("startAll logs enabled count and disabled count when disabled agents exist", () => {
			const spy = vi.spyOn(console, "log");
			const enabled1 = makeAgent(db, { name: "E1", cronSchedule: "0 * * * *", enabled: 1 });
			const disabled1 = makeAgent(db, { name: "D1", cronSchedule: "0 * * * *", enabled: 0 });
			const disabled2 = makeAgent(db, { name: "D2", cronSchedule: "0 * * * *", enabled: 0 });

			startAll([enabled1, disabled1, disabled2], db);
			expect(spy).toHaveBeenCalledWith("[cron] Scheduled 1 agent(s), 2 disabled");
			spy.mockRestore();
		});

		it("startAll with zero disabled agents logs without disabled suffix", () => {
			const spy = vi.spyOn(console, "log");
			const enabled1 = makeAgent(db, {
				name: "OnlyEnabled1",
				cronSchedule: "0 * * * *",
				enabled: 1,
			});
			const enabled2 = makeAgent(db, {
				name: "OnlyEnabled2",
				cronSchedule: "0 * * * *",
				enabled: 1,
			});

			startAll([enabled1, enabled2], db);
			expect(spy).toHaveBeenCalledWith("[cron] Scheduled 2 agent(s)");
			spy.mockRestore();
		});

		it("getJobCount reflects only enabled agents after startAll", () => {
			const enabled1 = makeAgent(db, { name: "CountE1", cronSchedule: "0 * * * *", enabled: 1 });
			const disabled1 = makeAgent(db, { name: "CountD1", cronSchedule: "0 * * * *", enabled: 0 });
			const enabled2 = makeAgent(db, { name: "CountE2", cronSchedule: "0 * * * *", enabled: 1 });
			const disabled2 = makeAgent(db, { name: "CountD2", cronSchedule: "0 * * * *", enabled: 0 });

			startAll([enabled1, disabled1, enabled2, disabled2], db);
			expect(getJobCount()).toBe(2);
		});
	});

	describe("stale data avoidance", () => {
		it("re-reads agent from DB before executing", async () => {
			const { eq } = await import("drizzle-orm");
			const agent = makeAgent(db, { cronSchedule: "* * * * * *" });
			scheduleAgent(agent, db);

			// Update agent in DB after scheduling
			db.update(schema.agents)
				.set({ taskDescription: "Updated task" })
				.where(eq(schema.agents.id, agent.id))
				.run();

			await new Promise((r) => setTimeout(r, 1500));

			expect(mockExecuteAgent).toHaveBeenCalled();
			// The scheduler should have re-read from DB, getting updated data
			const calledAgent = mockExecuteAgent.mock.calls[0][0];
			expect(calledAgent.taskDescription).toBe("Updated task");
		});

		it("skips execution if agent was deleted from DB", async () => {
			const agent = makeAgent(db, { cronSchedule: "* * * * * *" });
			scheduleAgent(agent, db);

			// Delete agent from DB
			const { eq } = await import("drizzle-orm");
			db.delete(schema.agents).where(eq(schema.agents.id, agent.id)).run();

			await new Promise((r) => setTimeout(r, 1500));

			// executeAgent should NOT have been called since agent is gone
			expect(mockExecuteAgent).not.toHaveBeenCalled();
		});
	});
});
