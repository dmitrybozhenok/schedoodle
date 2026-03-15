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
  estimated_cost REAL,
  retry_count INTEGER DEFAULT 0,
  tool_calls TEXT,
  started_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  completed_at TEXT
);
`;

const CREATE_TOOLS_SQL = `
CREATE TABLE tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'POST',
  headers TEXT,
  input_schema TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
`;

const CREATE_AGENT_TOOLS_SQL = `
CREATE TABLE agent_tools (
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_id INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE UNIQUE INDEX agent_tools_unique ON agent_tools(agent_id, tool_id);
`;

describe("database schema", () => {
	let sqlite: Database.Database;
	let db: ReturnType<typeof drizzle>;

	beforeEach(() => {
		sqlite = new Database(":memory:");
		sqlite.pragma("foreign_keys = ON");
		sqlite.exec(CREATE_AGENTS_SQL);
		sqlite.exec(CREATE_EXECUTION_HISTORY_SQL);
		sqlite.exec(CREATE_TOOLS_SQL);
		sqlite.exec(CREATE_AGENT_TOOLS_SQL);
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
		expect(names).toContain("tool_calls");
	});

	// --- Tools table tests ---

	it("inserts and retrieves a tool", () => {
		const inserted = db
			.insert(schema.tools)
			.values({
				name: "My Webhook",
				description: "Sends data to my API",
				url: "https://api.example.com/hook",
				method: "POST",
				headers: { Authorization: "Bearer abc123" },
				inputSchema: { type: "object", properties: { message: { type: "string" } } },
			})
			.returning()
			.get();

		expect(inserted).toBeDefined();
		expect(inserted.name).toBe("My Webhook");
		expect(inserted.description).toBe("Sends data to my API");
		expect(inserted.url).toBe("https://api.example.com/hook");
		expect(inserted.method).toBe("POST");
		expect(inserted.headers).toEqual({ Authorization: "Bearer abc123" });
		expect(inserted.inputSchema).toEqual({
			type: "object",
			properties: { message: { type: "string" } },
		});
		expect(inserted.id).toBeGreaterThan(0);
		expect(inserted.createdAt).toBeTruthy();
		expect(inserted.updatedAt).toBeTruthy();
	});

	// --- Agent tools join table tests ---

	it("links an agent to a tool via agent_tools join table", () => {
		const agent = db
			.insert(schema.agents)
			.values({
				name: "ToolAgent",
				taskDescription: "Uses tools",
				cronSchedule: "0 * * * *",
			})
			.returning()
			.get();

		const tool = db
			.insert(schema.tools)
			.values({
				name: "TestTool",
				description: "A test tool",
				url: "https://api.example.com",
				inputSchema: { type: "object" },
			})
			.returning()
			.get();

		const link = db
			.insert(schema.agentTools)
			.values({ agentId: agent.id, toolId: tool.id })
			.returning()
			.get();

		expect(link.agentId).toBe(agent.id);
		expect(link.toolId).toBe(tool.id);
		expect(link.createdAt).toBeTruthy();
	});

	it("enforces unique(agentId, toolId) constraint on agent_tools", () => {
		const agent = db
			.insert(schema.agents)
			.values({
				name: "UniqueAgent",
				taskDescription: "Unique test",
				cronSchedule: "0 * * * *",
			})
			.returning()
			.get();

		const tool = db
			.insert(schema.tools)
			.values({
				name: "UniqueTool",
				description: "A unique tool",
				url: "https://api.example.com",
				inputSchema: { type: "object" },
			})
			.returning()
			.get();

		db.insert(schema.agentTools)
			.values({ agentId: agent.id, toolId: tool.id })
			.run();

		expect(() => {
			db.insert(schema.agentTools)
				.values({ agentId: agent.id, toolId: tool.id })
				.run();
		}).toThrow();
	});

	it("cascade deletes agent_tools when tool is deleted", () => {
		const agent = db
			.insert(schema.agents)
			.values({
				name: "CascadeAgent",
				taskDescription: "Cascade test",
				cronSchedule: "0 * * * *",
			})
			.returning()
			.get();

		const tool = db
			.insert(schema.tools)
			.values({
				name: "CascadeTool",
				description: "Will be deleted",
				url: "https://api.example.com",
				inputSchema: { type: "object" },
			})
			.returning()
			.get();

		db.insert(schema.agentTools)
			.values({ agentId: agent.id, toolId: tool.id })
			.run();

		// Delete the tool
		const { eq } = require("drizzle-orm");
		db.delete(schema.tools).where(eq(schema.tools.id, tool.id)).run();

		// Join table entry should be gone
		const links = db.select().from(schema.agentTools).all();
		expect(links).toHaveLength(0);
	});

	it("cascade deletes agent_tools when agent is deleted", () => {
		const agent = db
			.insert(schema.agents)
			.values({
				name: "CascadeAgent2",
				taskDescription: "Cascade test 2",
				cronSchedule: "0 * * * *",
			})
			.returning()
			.get();

		const tool = db
			.insert(schema.tools)
			.values({
				name: "CascadeTool2",
				description: "Stays",
				url: "https://api.example.com",
				inputSchema: { type: "object" },
			})
			.returning()
			.get();

		db.insert(schema.agentTools)
			.values({ agentId: agent.id, toolId: tool.id })
			.run();

		// Delete the agent
		const { eq } = require("drizzle-orm");
		db.delete(schema.agents).where(eq(schema.agents.id, agent.id)).run();

		// Join table entry should be gone
		const links = db.select().from(schema.agentTools).all();
		expect(links).toHaveLength(0);
	});

	// --- maxExecutionMs on agents ---

	it("agents table accepts maxExecutionMs column (nullable)", () => {
		const agent = db
			.insert(schema.agents)
			.values({
				name: "TimeoutAgent",
				taskDescription: "Has timeout",
				cronSchedule: "0 * * * *",
				maxExecutionMs: 30000,
			})
			.returning()
			.get();

		expect(agent.maxExecutionMs).toBe(30000);

		// null case
		const agent2 = db
			.insert(schema.agents)
			.values({
				name: "NoTimeoutAgent",
				taskDescription: "No timeout",
				cronSchedule: "0 * * * *",
			})
			.returning()
			.get();

		expect(agent2.maxExecutionMs).toBeNull();
	});

	it("schema has max_execution_ms column on agents", () => {
		const columns = sqlite.pragma("table_info('agents')") as Array<{
			name: string;
		}>;
		const names = columns.map((c) => c.name);
		expect(names).toContain("max_execution_ms");
	});

	// --- toolCalls on executionHistory ---

	it("executionHistory accepts toolCalls JSON column (nullable)", () => {
		const agent = db
			.insert(schema.agents)
			.values({
				name: "ToolCallsAgent",
				taskDescription: "Logs tool calls",
				cronSchedule: "0 * * * *",
			})
			.returning()
			.get();

		const toolCallsData = [
			{ toolName: "web_fetch", input: { url: "https://example.com" }, output: "content", durationMs: 150 },
		];

		const exec = db
			.insert(schema.executionHistory)
			.values({
				agentId: agent.id,
				status: "success",
				toolCalls: toolCallsData,
			})
			.returning()
			.get();

		expect(exec.toolCalls).toEqual(toolCallsData);

		// null case
		const exec2 = db
			.insert(schema.executionHistory)
			.values({
				agentId: agent.id,
				status: "success",
			})
			.returning()
			.get();

		expect(exec2.toolCalls).toBeNull();
	});
});

// --- Tool input schema validation tests ---

import { createToolSchema, updateToolSchema } from "../src/schemas/tool-input.js";

describe("tool input schemas", () => {
	it("createToolSchema validates required fields", () => {
		const result = createToolSchema.safeParse({
			name: "My Tool",
			description: "Does things",
			url: "https://api.example.com/hook",
			inputSchema: { type: "object", properties: {} },
		});
		expect(result.success).toBe(true);
	});

	it("createToolSchema rejects missing name", () => {
		const result = createToolSchema.safeParse({
			description: "Does things",
			url: "https://api.example.com/hook",
			inputSchema: { type: "object" },
		});
		expect(result.success).toBe(false);
	});

	it("createToolSchema rejects missing description", () => {
		const result = createToolSchema.safeParse({
			name: "My Tool",
			url: "https://api.example.com/hook",
			inputSchema: { type: "object" },
		});
		expect(result.success).toBe(false);
	});

	it("createToolSchema rejects missing url", () => {
		const result = createToolSchema.safeParse({
			name: "My Tool",
			description: "Does things",
			inputSchema: { type: "object" },
		});
		expect(result.success).toBe(false);
	});

	it("createToolSchema rejects missing inputSchema", () => {
		const result = createToolSchema.safeParse({
			name: "My Tool",
			description: "Does things",
			url: "https://api.example.com/hook",
		});
		expect(result.success).toBe(false);
	});

	it("createToolSchema rejects invalid url", () => {
		const result = createToolSchema.safeParse({
			name: "My Tool",
			description: "Does things",
			url: "not-a-url",
			inputSchema: { type: "object" },
		});
		expect(result.success).toBe(false);
	});

	it("createToolSchema accepts optional method and headers", () => {
		const result = createToolSchema.safeParse({
			name: "My Tool",
			description: "Does things",
			url: "https://api.example.com/hook",
			method: "PUT",
			headers: { Authorization: "Bearer token" },
			inputSchema: { type: "object" },
		});
		expect(result.success).toBe(true);
	});

	it("updateToolSchema allows partial updates", () => {
		const result = updateToolSchema.safeParse({
			name: "Updated Name",
		});
		expect(result.success).toBe(true);
	});

	it("updateToolSchema allows empty object", () => {
		const result = updateToolSchema.safeParse({});
		expect(result.success).toBe(true);
	});
});
