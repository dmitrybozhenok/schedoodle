import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema.js";
import {
	insertRunningRecord,
	recordFailure,
	recordSuccess,
} from "../src/services/execution-recorder.js";

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
  agent_id INTEGER NOT NULL REFERENCES agents(id),
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

describe("execution-recorder", () => {
	let sqlite: Database.Database;
	let db: ReturnType<typeof drizzle>;
	let agentId: number;

	beforeEach(() => {
		sqlite = new Database(":memory:");
		sqlite.exec(CREATE_AGENTS_SQL);
		sqlite.exec(CREATE_EXECUTION_HISTORY_SQL);
		db = drizzle(sqlite, { schema });

		// Insert a test agent
		const agent = db
			.insert(schema.agents)
			.values({
				name: "TestAgent",
				taskDescription: "Do the thing",
				cronSchedule: "0 * * * *",
			})
			.returning()
			.get();
		agentId = agent.id;
	});

	afterEach(() => {
		sqlite.close();
	});

	describe("insertRunningRecord", () => {
		it("returns row with status 'running' and a numeric id", () => {
			const row = insertRunningRecord(agentId, db);

			expect(row.id).toBeTypeOf("number");
			expect(row.id).toBeGreaterThan(0);
			expect(row.status).toBe("running");
			expect(row.agentId).toBe(agentId);
		});

		it("creates a row visible in the database", () => {
			const row = insertRunningRecord(agentId, db);

			const rows = db
				.select()
				.from(schema.executionHistory)
				.where(eq(schema.executionHistory.id, row.id))
				.all();

			expect(rows).toHaveLength(1);
			expect(rows[0].status).toBe("running");
		});
	});

	describe("recordSuccess", () => {
		it("updates the row to status 'success' with all metrics", () => {
			const inserted = insertRunningRecord(agentId, db);

			recordSuccess(inserted.id, db, {
				result: { summary: "done", details: "all good" },
				inputTokens: 100,
				outputTokens: 50,
				estimatedCost: 0.005,
				retryCount: 0,
				durationMs: 1234,
				toolCalls: null,
			});

			const rows = db
				.select()
				.from(schema.executionHistory)
				.where(eq(schema.executionHistory.id, inserted.id))
				.all();

			expect(rows[0].status).toBe("success");
			expect(rows[0].result).toEqual({ summary: "done", details: "all good" });
			expect(rows[0].inputTokens).toBe(100);
			expect(rows[0].outputTokens).toBe(50);
			expect(rows[0].estimatedCost).toBeCloseTo(0.005);
			expect(rows[0].retryCount).toBe(0);
			expect(rows[0].durationMs).toBe(1234);
			expect(rows[0].completedAt).toBeTruthy();
		});

		it("stores tool calls when provided", () => {
			const inserted = insertRunningRecord(agentId, db);

			const toolCalls = [
				{
					toolName: "web_fetch",
					input: { url: "https://example.com" },
					output: "content",
					durationMs: 100,
				},
			];
			recordSuccess(inserted.id, db, {
				result: { summary: "done", details: "ok" },
				inputTokens: 10,
				outputTokens: 20,
				estimatedCost: 0.001,
				retryCount: 1,
				durationMs: 500,
				toolCalls,
			});

			const rows = db
				.select()
				.from(schema.executionHistory)
				.where(eq(schema.executionHistory.id, inserted.id))
				.all();

			expect(rows[0].toolCalls).toEqual(toolCalls);
		});
	});

	describe("recordFailure", () => {
		it("updates the row to status 'failure' with error message", () => {
			const inserted = insertRunningRecord(agentId, db);

			recordFailure(inserted.id, db, {
				error: "API key invalid",
				estimatedCost: null,
				retryCount: 0,
				durationMs: 200,
			});

			const rows = db
				.select()
				.from(schema.executionHistory)
				.where(eq(schema.executionHistory.id, inserted.id))
				.all();

			expect(rows[0].status).toBe("failure");
			expect(rows[0].error).toBe("API key invalid");
			expect(rows[0].durationMs).toBe(200);
			expect(rows[0].completedAt).toBeTruthy();
		});

		it("records estimatedCost when provided", () => {
			const inserted = insertRunningRecord(agentId, db);

			recordFailure(inserted.id, db, {
				error: "Circuit breaker open",
				estimatedCost: 0,
				retryCount: 0,
				durationMs: 5,
			});

			const rows = db
				.select()
				.from(schema.executionHistory)
				.where(eq(schema.executionHistory.id, inserted.id))
				.all();

			expect(rows[0].estimatedCost).toBe(0);
		});
	});
});
