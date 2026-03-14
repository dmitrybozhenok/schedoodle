import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema.js";

const CREATE_AGENTS_SQL = `
CREATE TABLE agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  task_description TEXT NOT NULL,
  cron_schedule TEXT NOT NULL,
  system_prompt TEXT,
  model TEXT,
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
  estimated_cost REAL,
  started_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  completed_at TEXT
);
`;

describe("database schema", () => {
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

	it("inserts and retrieves an agent", () => {
		const inserted = db
			.insert(schema.agents)
			.values({
				name: "TestAgent",
				taskDescription: "Describe a task",
				cronSchedule: "0 * * * *",
			})
			.returning()
			.get();

		expect(inserted).toBeDefined();
		expect(inserted.name).toBe("TestAgent");
		expect(inserted.taskDescription).toBe("Describe a task");
		expect(inserted.cronSchedule).toBe("0 * * * *");
		expect(inserted.id).toBeGreaterThan(0);
	});

	it("enforces case-insensitive name uniqueness", () => {
		db.insert(schema.agents)
			.values({
				name: "TestAgent",
				taskDescription: "First",
				cronSchedule: "0 * * * *",
			})
			.run();

		expect(() => {
			db.insert(schema.agents)
				.values({
					name: "testagent",
					taskDescription: "Second",
					cronSchedule: "0 * * * *",
				})
				.run();
		}).toThrow();
	});

	it("auto-populates createdAt and updatedAt", () => {
		const agent = db
			.insert(schema.agents)
			.values({
				name: "TimestampAgent",
				taskDescription: "Check timestamps",
				cronSchedule: "0 * * * *",
			})
			.returning()
			.get();

		expect(agent.createdAt).toBeTruthy();
		expect(agent.updatedAt).toBeTruthy();
	});

	it("inserts execution history with all fields", () => {
		const agent = db
			.insert(schema.agents)
			.values({
				name: "ExecAgent",
				taskDescription: "Run tasks",
				cronSchedule: "0 * * * *",
			})
			.returning()
			.get();

		const exec = db
			.insert(schema.executionHistory)
			.values({
				agentId: agent.id,
				status: "success",
				inputTokens: 100,
				outputTokens: 200,
				durationMs: 1500,
				result: { summary: "done" },
				error: null,
				deliveryStatus: "sent",
			})
			.returning()
			.get();

		expect(exec).toBeDefined();
		expect(exec.agentId).toBe(agent.id);
		expect(exec.status).toBe("success");
		expect(exec.inputTokens).toBe(100);
		expect(exec.outputTokens).toBe(200);
		expect(exec.durationMs).toBe(1500);
		expect(exec.deliveryStatus).toBe("sent");
		expect(exec.startedAt).toBeTruthy();
	});

	it("stores and retrieves JSON in result field", () => {
		const agent = db
			.insert(schema.agents)
			.values({
				name: "JsonAgent",
				taskDescription: "JSON test",
				cronSchedule: "0 * * * *",
			})
			.returning()
			.get();

		const payload = { summary: "test", items: [1, 2, 3] };
		db.insert(schema.executionHistory)
			.values({
				agentId: agent.id,
				status: "success",
				result: payload,
			})
			.run();

		const rows = db.select().from(schema.executionHistory).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].result).toEqual(payload);
	});

	it("schema has expected agent columns", () => {
		const columns = sqlite.pragma("table_info('agents')") as Array<{
			name: string;
		}>;
		const names = columns.map((c) => c.name);
		expect(names).toContain("id");
		expect(names).toContain("name");
		expect(names).toContain("task_description");
		expect(names).toContain("cron_schedule");
		expect(names).toContain("system_prompt");
		expect(names).toContain("model");
		expect(names).toContain("created_at");
		expect(names).toContain("updated_at");
	});

	it("schema has expected execution_history columns", () => {
		const columns = sqlite.pragma("table_info('execution_history')") as Array<{
			name: string;
		}>;
		const names = columns.map((c) => c.name);
		expect(names).toContain("id");
		expect(names).toContain("agent_id");
		expect(names).toContain("status");
		expect(names).toContain("input_tokens");
		expect(names).toContain("output_tokens");
		expect(names).toContain("duration_ms");
		expect(names).toContain("result");
		expect(names).toContain("error");
		expect(names).toContain("delivery_status");
		expect(names).toContain("started_at");
		expect(names).toContain("completed_at");
	});
});
