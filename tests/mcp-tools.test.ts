import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema.js";

// Mock executor to avoid real LLM calls (health tools import executor)
vi.mock("../src/services/executor.js", () => ({
	executeAgent: vi.fn(),
	getLlmCircuitStatus: vi.fn().mockReturnValue({
		state: "CLOSED",
		failures: 0,
		lastFailureTime: null,
		name: "anthropic",
	}),
	getLlmSemaphoreStatus: vi.fn().mockReturnValue({
		active: 0,
		queued: 0,
		limit: 3,
	}),
}));

// Mock schedule parser to avoid real LLM calls
const mockParseSchedule = vi.fn().mockResolvedValue({
	input: "every weekday at 9am",
	cronExpression: "0 9 * * 1-5",
	humanReadable: "At 09:00, Monday through Friday",
	confidence: "high",
	interpretation: "Every weekday at 9am",
});

vi.mock("../src/services/schedule-parser.js", () => ({
	parseSchedule: (...args: unknown[]) => mockParseSchedule(...args),
}));

// Mock notifier
vi.mock("../src/services/notifier.js", () => ({
	sendNotification: vi.fn().mockResolvedValue({ status: "skipped" }),
	sendFailureNotification: vi.fn().mockResolvedValue({ status: "skipped" }),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolTools } from "../src/mcp/tools/tools.js";

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
CREATE INDEX idx_exec_agent_id ON execution_history(agent_id);
CREATE INDEX idx_exec_agent_started ON execution_history(agent_id, started_at);
CREATE INDEX idx_exec_status ON execution_history(status);
`;

const CREATE_TOOLS_SQL = `
CREATE TABLE tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'POST' CHECK(method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
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

type DB = ReturnType<typeof drizzle>;

function makeAgent(db: DB, overrides: Partial<schema.agents.$inferInsert> = {}) {
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

function makeTool(db: DB, overrides: Partial<schema.tools.$inferInsert> = {}) {
	return db
		.insert(schema.tools)
		.values({
			name: overrides.name ?? "TestTool",
			description: overrides.description ?? "A test tool",
			url: overrides.url ?? "https://example.com/webhook",
			method: overrides.method ?? "POST",
			headers: overrides.headers ?? null,
			inputSchema: overrides.inputSchema ?? { type: "object", properties: {} },
			...overrides,
		})
		.returning()
		.get();
}

function parseResult(result: { content: Array<{ type: string; text?: string }> }) {
	const textContent = result.content.find((c) => c.type === "text");
	return textContent?.text ? JSON.parse(textContent.text) : null;
}

async function createTestEnv(db: DB) {
	const server = new McpServer({ name: "test-tools", version: "1.0.0" });
	registerToolTools(server, db);

	const client = new Client({ name: "test-client", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

	await server.connect(serverTransport);
	await client.connect(clientTransport);

	return { server, client };
}

describe("MCP Tool CRUD", () => {
	let sqlite: Database.Database;
	let db: DB;
	let client: Client;
	let server: McpServer;

	beforeEach(async () => {
		sqlite = new Database(":memory:");
		sqlite.pragma("foreign_keys = ON");
		sqlite.exec(CREATE_AGENTS_SQL);
		sqlite.exec(CREATE_EXECUTION_HISTORY_SQL);
		sqlite.exec(CREATE_TOOLS_SQL);
		sqlite.exec(CREATE_AGENT_TOOLS_SQL);
		db = drizzle(sqlite, { schema });

		const env = await createTestEnv(db);
		client = env.client;
		server = env.server;
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await client.close();
		await server.close();
		sqlite.close();
	});

	// --- list_tools ---

	describe("list_tools", () => {
		it("returns empty array when no tools exist", async () => {
			const result = await client.callTool({ name: "list_tools", arguments: {} });
			const data = parseResult(result);
			expect(data).toEqual([]);
		});

		it("returns all tools when populated", async () => {
			makeTool(db, { name: "Tool1" });
			makeTool(db, { name: "Tool2" });

			const result = await client.callTool({ name: "list_tools", arguments: {} });
			const data = parseResult(result);

			expect(data).toHaveLength(2);
			expect(data[0].name).toBe("Tool1");
			expect(data[1].name).toBe("Tool2");
		});
	});

	// --- get_tool ---

	describe("get_tool", () => {
		it("returns tool for valid ID", async () => {
			const tool = makeTool(db, { name: "GetMe" });

			const result = await client.callTool({ name: "get_tool", arguments: { id: tool.id } });
			const data = parseResult(result);

			expect(data.name).toBe("GetMe");
			expect(data.id).toBe(tool.id);
		});

		it("returns isError with guidance for nonexistent ID", async () => {
			const result = await client.callTool({ name: "get_tool", arguments: { id: 999 } });
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Tool not found");
			expect(data.guidance).toContain("list_tools");
		});
	});

	// --- create_tool ---

	describe("create_tool", () => {
		it("inserts tool into DB and returns it", async () => {
			const result = await client.callTool({
				name: "create_tool",
				arguments: {
					name: "NewTool",
					description: "Does things",
					url: "https://example.com/hook",
					inputSchema: { type: "object", properties: { q: { type: "string" } } },
				},
			});
			const data = parseResult(result);

			expect(data.name).toBe("NewTool");
			expect(data.description).toBe("Does things");
			expect(data.url).toBe("https://example.com/hook");
			expect(data.method).toBe("POST"); // default
			expect(data.id).toBeGreaterThan(0);
		});
	});

	// --- update_tool ---

	describe("update_tool", () => {
		it("modifies tool fields and returns updated tool", async () => {
			const tool = makeTool(db, { name: "Original" });

			const result = await client.callTool({
				name: "update_tool",
				arguments: { id: tool.id, name: "Updated", method: "GET" },
			});
			const data = parseResult(result);

			expect(data.name).toBe("Updated");
			expect(data.method).toBe("GET");
			expect(data.url).toBe("https://example.com/webhook"); // unchanged
		});

		it("returns isError with guidance for nonexistent ID", async () => {
			const result = await client.callTool({
				name: "update_tool",
				arguments: { id: 999, name: "Ghost" },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Tool not found");
			expect(data.guidance).toContain("list_tools");
		});
	});

	// --- delete_tool ---

	describe("delete_tool", () => {
		it("without confirm returns preview with tool data", async () => {
			const tool = makeTool(db, { name: "DeleteMe" });

			const result = await client.callTool({
				name: "delete_tool",
				arguments: { id: tool.id },
			});
			const data = parseResult(result);

			expect(result.isError).toBeUndefined();
			expect(data.action).toBe("delete_tool");
			expect(data.preview).toBeDefined();
			expect(data.preview.name).toBe("DeleteMe");
			expect(data.message).toContain("confirm=true");
		});

		it("with confirm=true deletes tool", async () => {
			const tool = makeTool(db, { name: "ConfirmDelete" });

			const result = await client.callTool({
				name: "delete_tool",
				arguments: { id: tool.id, confirm: true },
			});
			const data = parseResult(result);

			expect(data.deleted).toBe(true);
			expect(data.toolId).toBe(tool.id);
			expect(data.toolName).toBe("ConfirmDelete");

			// Verify tool is gone from DB
			const remaining = db.select().from(schema.tools).all();
			expect(remaining).toHaveLength(0);
		});

		it("returns isError for nonexistent ID", async () => {
			const result = await client.callTool({
				name: "delete_tool",
				arguments: { id: 999 },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Tool not found");
			expect(data.guidance).toContain("list_tools");
		});
	});

	// --- list_agent_tools ---

	describe("list_agent_tools", () => {
		it("returns empty array when no tools attached", async () => {
			const agent = makeAgent(db, { name: "NoTools" });

			const result = await client.callTool({
				name: "list_agent_tools",
				arguments: { agentId: agent.id },
			});
			const data = parseResult(result);

			expect(data).toEqual([]);
		});

		it("returns tools attached to agent", async () => {
			const agent = makeAgent(db, { name: "WithTools" });
			const tool1 = makeTool(db, { name: "Tool1" });
			const tool2 = makeTool(db, { name: "Tool2" });

			db.insert(schema.agentTools).values({ agentId: agent.id, toolId: tool1.id }).run();
			db.insert(schema.agentTools).values({ agentId: agent.id, toolId: tool2.id }).run();

			const result = await client.callTool({
				name: "list_agent_tools",
				arguments: { agentId: agent.id },
			});
			const data = parseResult(result);

			expect(data).toHaveLength(2);
			const names = data.map((t: { name: string }) => t.name).sort();
			expect(names).toEqual(["Tool1", "Tool2"]);
		});

		it("returns isError for nonexistent agent", async () => {
			const result = await client.callTool({
				name: "list_agent_tools",
				arguments: { agentId: 999 },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Agent not found");
			expect(data.guidance).toContain("list_agents");
		});
	});

	// --- attach_tool ---

	describe("attach_tool", () => {
		it("creates link and returns confirmation", async () => {
			const agent = makeAgent(db, { name: "Agent1" });
			const tool = makeTool(db, { name: "Tool1" });

			const result = await client.callTool({
				name: "attach_tool",
				arguments: { agentId: agent.id, toolId: tool.id },
			});
			const data = parseResult(result);

			expect(data.agentId).toBe(agent.id);
			expect(data.toolId).toBe(tool.id);
			expect(data.attached).toBe(true);

			// Verify link in DB
			const links = db.select().from(schema.agentTools).all();
			expect(links).toHaveLength(1);
		});

		it("for already-attached returns isError", async () => {
			const agent = makeAgent(db, { name: "Agent2" });
			const tool = makeTool(db, { name: "Tool2" });

			db.insert(schema.agentTools).values({ agentId: agent.id, toolId: tool.id }).run();

			const result = await client.callTool({
				name: "attach_tool",
				arguments: { agentId: agent.id, toolId: tool.id },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Tool already attached");
			expect(data.guidance).toContain("list_agent_tools");
		});

		it("returns isError for nonexistent agent", async () => {
			const tool = makeTool(db, { name: "Tool3" });

			const result = await client.callTool({
				name: "attach_tool",
				arguments: { agentId: 999, toolId: tool.id },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Agent not found");
		});

		it("returns isError for nonexistent tool", async () => {
			const agent = makeAgent(db, { name: "Agent3" });

			const result = await client.callTool({
				name: "attach_tool",
				arguments: { agentId: agent.id, toolId: 999 },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Tool not found");
		});
	});

	// --- detach_tool ---

	describe("detach_tool", () => {
		it("removes link and returns confirmation", async () => {
			const agent = makeAgent(db, { name: "DetachAgent" });
			const tool = makeTool(db, { name: "DetachTool" });

			db.insert(schema.agentTools).values({ agentId: agent.id, toolId: tool.id }).run();

			const result = await client.callTool({
				name: "detach_tool",
				arguments: { agentId: agent.id, toolId: tool.id },
			});
			const data = parseResult(result);

			expect(data.agentId).toBe(agent.id);
			expect(data.toolId).toBe(tool.id);
			expect(data.detached).toBe(true);

			// Verify link is gone
			const links = db.select().from(schema.agentTools).all();
			expect(links).toHaveLength(0);
		});

		it("returns isError for not-attached tool", async () => {
			const result = await client.callTool({
				name: "detach_tool",
				arguments: { agentId: 1, toolId: 1 },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Tool not attached");
			expect(data.guidance).toContain("list_agent_tools");
		});
	});

	// --- Error guidance ---

	describe("error guidance", () => {
		it("all error responses include guidance field", async () => {
			const r1 = await client.callTool({ name: "get_tool", arguments: { id: 999 } });
			expect(parseResult(r1).guidance).toBeTruthy();

			const r2 = await client.callTool({
				name: "update_tool",
				arguments: { id: 999, name: "X" },
			});
			expect(parseResult(r2).guidance).toBeTruthy();

			const r3 = await client.callTool({
				name: "delete_tool",
				arguments: { id: 999 },
			});
			expect(parseResult(r3).guidance).toBeTruthy();

			const r4 = await client.callTool({
				name: "list_agent_tools",
				arguments: { agentId: 999 },
			});
			expect(parseResult(r4).guidance).toBeTruthy();

			const r5 = await client.callTool({
				name: "detach_tool",
				arguments: { agentId: 999, toolId: 999 },
			});
			expect(parseResult(r5).guidance).toBeTruthy();
		});
	});
});
