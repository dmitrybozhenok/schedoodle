import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema.js";

import {
	enrichAgent,
	getConsecutiveFailures,
	getLastRunAt,
	getNextRunAt,
} from "../src/helpers/enrich-agent.js";
import { createAgentSchema } from "../src/schemas/agent-input.js";

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
			cronSchedule: overrides.cronSchedule ?? "0 * * * *",
			systemPrompt: overrides.systemPrompt ?? null,
			model: overrides.model ?? null,
			...overrides,
		})
		.returning()
		.get();
}

describe("enrichAgent helper", () => {
	let sqlite: Database.Database;
	let db: ReturnType<typeof drizzle>;

	beforeEach(() => {
		sqlite = new Database(":memory:");
		sqlite.exec(CREATE_AGENTS_SQL);
		sqlite.exec(CREATE_EXECUTION_HISTORY_SQL);
		db = drizzle(sqlite, { schema });
	});

	afterEach(() => {
		sqlite.close();
	});

	describe("enabled boolean conversion", () => {
		it("returns enabled as boolean true (not integer 1) for enabled agent", () => {
			const agent = makeAgent(db, { enabled: 1 });
			const enriched = enrichAgent(agent, db);
			expect(enriched.enabled).toBe(true);
			expect(typeof enriched.enabled).toBe("boolean");
		});

		it("returns enabled as boolean false for disabled agent", () => {
			const agent = makeAgent(db, { enabled: 0 });
			const enriched = enrichAgent(agent, db);
			expect(enriched.enabled).toBe(false);
			expect(typeof enriched.enabled).toBe("boolean");
		});
	});

	describe("nextRunAt", () => {
		it("returns nextRunAt as ISO string for enabled agent with valid cron", () => {
			const agent = makeAgent(db, { enabled: 1, cronSchedule: "0 * * * *" });
			const enriched = enrichAgent(agent, db);
			expect(enriched.nextRunAt).toBeTruthy();
			expect(typeof enriched.nextRunAt).toBe("string");
			// Verify it's a valid ISO date
			expect(new Date(enriched.nextRunAt as string).toISOString()).toBe(enriched.nextRunAt);
		});

		it("returns nextRunAt as null for disabled agent", () => {
			const agent = makeAgent(db, { enabled: 0, cronSchedule: "0 * * * *" });
			const enriched = enrichAgent(agent, db);
			expect(enriched.nextRunAt).toBeNull();
		});
	});

	describe("lastRunAt", () => {
		it("returns lastRunAt from latest execution_history row", () => {
			const agent = makeAgent(db);
			// Insert two executions
			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "success",
					startedAt: "2026-01-01T00:00:00Z",
				})
				.run();
			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "success",
					startedAt: "2026-01-02T12:00:00Z",
				})
				.run();

			const enriched = enrichAgent(agent, db);
			expect(enriched.lastRunAt).toBe("2026-01-02T12:00:00Z");
		});

		it("returns lastRunAt as null when no executions exist", () => {
			const agent = makeAgent(db);
			const enriched = enrichAgent(agent, db);
			expect(enriched.lastRunAt).toBeNull();
		});
	});

	describe("getNextRunAt standalone", () => {
		it("returns ISO string for enabled agent", () => {
			const agent = makeAgent(db, { enabled: 1, cronSchedule: "0 * * * *" });
			const next = getNextRunAt(agent);
			expect(next).toBeTruthy();
			expect(typeof next).toBe("string");
		});

		it("returns null for disabled agent", () => {
			const agent = makeAgent(db, { enabled: 0, cronSchedule: "0 * * * *" });
			const next = getNextRunAt(agent);
			expect(next).toBeNull();
		});
	});

	describe("getLastRunAt standalone", () => {
		it("returns latest startedAt", () => {
			const agent = makeAgent(db);
			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "success",
					startedAt: "2026-03-01T10:00:00Z",
				})
				.run();
			const last = getLastRunAt(agent.id, db);
			expect(last).toBe("2026-03-01T10:00:00Z");
		});

		it("returns null when no executions", () => {
			const last = getLastRunAt(999, db);
			expect(last).toBeNull();
		});
	});

	describe("healthy flag and consecutiveFailures", () => {
		it("returns healthy=true and consecutiveFailures=0 for agent with no executions", () => {
			const agent = makeAgent(db);
			const enriched = enrichAgent(agent, db);
			expect(enriched.healthy).toBe(true);
			expect(enriched.consecutiveFailures).toBe(0);
		});

		it("returns healthy=true and consecutiveFailures=2 for agent with 2 consecutive failures", () => {
			const agent = makeAgent(db);
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "failure", startedAt: "2026-03-01T01:00:00Z" })
				.run();
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "failure", startedAt: "2026-03-01T02:00:00Z" })
				.run();

			const enriched = enrichAgent(agent, db);
			expect(enriched.healthy).toBe(true);
			expect(enriched.consecutiveFailures).toBe(2);
		});

		it("returns healthy=false and consecutiveFailures=3 for agent with 3 consecutive failures", () => {
			const agent = makeAgent(db);
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "failure", startedAt: "2026-03-01T01:00:00Z" })
				.run();
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "failure", startedAt: "2026-03-01T02:00:00Z" })
				.run();
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "failure", startedAt: "2026-03-01T03:00:00Z" })
				.run();

			const enriched = enrichAgent(agent, db);
			expect(enriched.healthy).toBe(false);
			expect(enriched.consecutiveFailures).toBe(3);
		});

		it("returns healthy=true and consecutiveFailures=0 after a success following 3 failures (auto-recover)", () => {
			const agent = makeAgent(db);
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "failure", startedAt: "2026-03-01T01:00:00Z" })
				.run();
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "failure", startedAt: "2026-03-01T02:00:00Z" })
				.run();
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "failure", startedAt: "2026-03-01T03:00:00Z" })
				.run();
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "success", startedAt: "2026-03-01T04:00:00Z" })
				.run();

			const enriched = enrichAgent(agent, db);
			expect(enriched.healthy).toBe(true);
			expect(enriched.consecutiveFailures).toBe(0);
		});

		it("returns consecutiveFailures=0 for interleaved success-failure-success (most recent is success)", () => {
			const agent = makeAgent(db);
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "success", startedAt: "2026-03-01T01:00:00Z" })
				.run();
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "failure", startedAt: "2026-03-01T02:00:00Z" })
				.run();
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "failure", startedAt: "2026-03-01T03:00:00Z" })
				.run();
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "success", startedAt: "2026-03-01T04:00:00Z" })
				.run();

			const enriched = enrichAgent(agent, db);
			expect(enriched.consecutiveFailures).toBe(0);
		});

		it("excludes 'running' status rows from consecutive failure count", () => {
			const agent = makeAgent(db);
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "failure", startedAt: "2026-03-01T01:00:00Z" })
				.run();
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "failure", startedAt: "2026-03-01T02:00:00Z" })
				.run();
			db.insert(schema.executionHistory)
				.values({ agentId: agent.id, status: "running", startedAt: "2026-03-01T03:00:00Z" })
				.run();

			// running row should be excluded, so only 2 consecutive failures
			const count = getConsecutiveFailures(agent.id, db);
			expect(count).toBe(2);
		});
	});
});

describe("createAgentSchema enabled field", () => {
	it("accepts enabled: true", () => {
		const result = createAgentSchema.safeParse({
			name: "TestAgent",
			taskDescription: "Do the thing",
			cronSchedule: "0 * * * *",
			enabled: true,
		});
		expect(result.success).toBe(true);
	});

	it("accepts enabled: false", () => {
		const result = createAgentSchema.safeParse({
			name: "TestAgent",
			taskDescription: "Do the thing",
			cronSchedule: "0 * * * *",
			enabled: false,
		});
		expect(result.success).toBe(true);
	});

	it("treats enabled as optional (omitting it is valid)", () => {
		const result = createAgentSchema.safeParse({
			name: "TestAgent",
			taskDescription: "Do the thing",
			cronSchedule: "0 * * * *",
		});
		expect(result.success).toBe(true);
	});
});
