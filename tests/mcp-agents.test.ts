import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema.js";

// Mock executor to avoid real LLM calls
const mockExecuteAgent = vi.fn().mockResolvedValue({
	status: "success",
	executionId: 1,
	output: { summary: "test execution result" },
});

vi.mock("../src/services/executor.js", () => ({
	executeAgent: (...args: unknown[]) => mockExecuteAgent(...args),
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

// Mock notifier to avoid side effects
vi.mock("../src/services/notifier.js", () => ({
	sendNotification: vi.fn().mockResolvedValue({ status: "skipped" }),
	sendFailureNotification: vi.fn().mockResolvedValue({ status: "skipped" }),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAgentTools } from "../src/mcp/tools/agents.js";
import { registerHistoryTools } from "../src/mcp/tools/history.js";

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

/**
 * Parse the text content from an MCP tool result.
 */
function parseResult(result: { content: Array<{ type: string; text?: string }> }) {
	const textContent = result.content.find((c) => c.type === "text");
	return textContent?.text ? JSON.parse(textContent.text) : null;
}

/**
 * Create an in-memory MCP server + client pair for testing.
 */
async function createTestEnv(db: DB) {
	const server = new McpServer({ name: "test-schedoodle", version: "1.0.0" });
	registerAgentTools(server, db);
	registerHistoryTools(server, db);

	const client = new Client({ name: "test-client", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

	await server.connect(serverTransport);
	await client.connect(clientTransport);

	return { server, client };
}

describe("MCP Agent Tools", () => {
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

	// --- list_agents ---

	describe("list_agents", () => {
		it("returns all agents enriched", async () => {
			makeAgent(db, { name: "Agent1" });
			makeAgent(db, { name: "Agent2" });

			const result = await client.callTool({ name: "list_agents", arguments: {} });
			const data = parseResult(result);

			expect(data).toHaveLength(2);
			for (const agent of data) {
				expect(agent).toHaveProperty("enabled");
				expect(agent).toHaveProperty("nextRunAt");
				expect(agent).toHaveProperty("lastRunAt");
				expect(agent).toHaveProperty("healthy");
				expect(agent).toHaveProperty("consecutiveFailures");
				expect(typeof agent.enabled).toBe("boolean");
			}
		});

		it("returns empty array when no agents exist", async () => {
			const result = await client.callTool({ name: "list_agents", arguments: {} });
			const data = parseResult(result);
			expect(data).toEqual([]);
		});

		it("filters by enabled=true", async () => {
			makeAgent(db, { name: "Enabled1" });
			makeAgent(db, { name: "Disabled1", enabled: 0 });
			makeAgent(db, { name: "Enabled2" });

			const result = await client.callTool({
				name: "list_agents",
				arguments: { enabled: "true" },
			});
			const data = parseResult(result);

			expect(data).toHaveLength(2);
			expect(data.every((a: { enabled: boolean }) => a.enabled === true)).toBe(true);
		});

		it("filters by enabled=false", async () => {
			makeAgent(db, { name: "Enabled1" });
			makeAgent(db, { name: "Disabled1", enabled: 0 });

			const result = await client.callTool({
				name: "list_agents",
				arguments: { enabled: "false" },
			});
			const data = parseResult(result);

			expect(data).toHaveLength(1);
			expect(data[0].enabled).toBe(false);
		});
	});

	// --- get_agent ---

	describe("get_agent", () => {
		it("returns enriched agent for valid ID", async () => {
			const agent = makeAgent(db, { name: "SingleAgent" });

			const result = await client.callTool({
				name: "get_agent",
				arguments: { id: agent.id },
			});
			const data = parseResult(result);

			expect(data.name).toBe("SingleAgent");
			expect(data.id).toBe(agent.id);
			expect(typeof data.enabled).toBe("boolean");
			expect(data).toHaveProperty("nextRunAt");
			expect(data).toHaveProperty("lastRunAt");
			expect(data).toHaveProperty("healthy");
			expect(data).toHaveProperty("consecutiveFailures");
		});

		it("returns isError with guidance for nonexistent ID", async () => {
			const result = await client.callTool({
				name: "get_agent",
				arguments: { id: 999 },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Agent not found");
			expect(data.guidance).toContain("list_agents");
		});
	});

	// --- create_agent ---

	describe("create_agent", () => {
		it("inserts agent into DB and returns enriched agent", async () => {
			const result = await client.callTool({
				name: "create_agent",
				arguments: {
					name: "NewAgent",
					taskDescription: "Summarize news",
					cronSchedule: "0 9 * * *",
				},
			});
			const data = parseResult(result);

			expect(data.message).toBe("Agent created successfully");
			expect(data.agent.name).toBe("NewAgent");
			expect(data.agent.taskDescription).toBe("Summarize news");
			expect(data.agent.cronSchedule).toBe("0 9 * * *");
			expect(data.agent.id).toBeGreaterThan(0);
			expect(typeof data.agent.enabled).toBe("boolean");
			expect(data.agent.enabled).toBe(true);
		});

		it("with duplicate name returns isError with guidance", async () => {
			makeAgent(db, { name: "DuplicateAgent" });

			const result = await client.callTool({
				name: "create_agent",
				arguments: {
					name: "DuplicateAgent",
					taskDescription: "Another one",
					cronSchedule: "0 * * * *",
				},
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Agent name already exists");
			expect(data.guidance).toContain("update_agent");
		});

		it("with enabled=false creates disabled agent", async () => {
			const result = await client.callTool({
				name: "create_agent",
				arguments: {
					name: "DisabledAgent",
					taskDescription: "Test",
					cronSchedule: "0 * * * *",
					enabled: false,
				},
			});
			const data = parseResult(result);

			expect(data.agent.enabled).toBe(false);
			expect(data.agent.nextRunAt).toBeNull();
		});
	});

	// --- update_agent ---

	describe("update_agent", () => {
		it("modifies agent fields and returns updated enriched agent", async () => {
			const agent = makeAgent(db, { name: "Original" });

			const result = await client.callTool({
				name: "update_agent",
				arguments: { id: agent.id, name: "Updated" },
			});
			const data = parseResult(result);

			expect(data.name).toBe("Updated");
			expect(data.taskDescription).toBe("Do the thing"); // unchanged
		});

		it("for nonexistent ID returns isError with guidance", async () => {
			const result = await client.callTool({
				name: "update_agent",
				arguments: { id: 999, name: "Ghost" },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Agent not found");
			expect(data.guidance).toContain("list_agents");
		});
	});

	// --- delete_agent ---

	describe("delete_agent", () => {
		it("without confirm returns preview with agent data", async () => {
			const agent = makeAgent(db, { name: "DeleteMe" });

			const result = await client.callTool({
				name: "delete_agent",
				arguments: { id: agent.id },
			});
			const data = parseResult(result);

			expect(result.isError).toBeUndefined();
			expect(data.action).toBe("delete_agent");
			expect(data.preview).toBeDefined();
			expect(data.preview.name).toBe("DeleteMe");
			expect(data.message).toContain("confirm=true");
		});

		it("with confirm=true deletes agent and returns confirmation", async () => {
			const agent = makeAgent(db, { name: "ConfirmDelete" });

			const result = await client.callTool({
				name: "delete_agent",
				arguments: { id: agent.id, confirm: true },
			});
			const data = parseResult(result);

			expect(data.deleted).toBe(true);
			expect(data.agentId).toBe(agent.id);
			expect(data.agentName).toBe("ConfirmDelete");

			// Verify agent is actually gone from DB
			const remaining = db.select().from(schema.agents).all();
			expect(remaining).toHaveLength(0);
		});

		it("for nonexistent ID returns isError with guidance", async () => {
			const result = await client.callTool({
				name: "delete_agent",
				arguments: { id: 999 },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Agent not found");
			expect(data.guidance).toContain("list_agents");
		});
	});

	// --- execute_agent ---

	describe("execute_agent", () => {
		it("calls executeAgent and returns result", async () => {
			const agent = makeAgent(db, { name: "ExecAgent" });

			const result = await client.callTool({
				name: "execute_agent",
				arguments: { id: agent.id },
			});
			const data = parseResult(result);

			expect(mockExecuteAgent).toHaveBeenCalledTimes(1);
			expect(data.status).toBe("success");
			expect(data.output).toEqual({ summary: "test execution result" });
		});

		it("for disabled agent returns isError with enable guidance", async () => {
			makeAgent(db, { name: "DisabledExec", enabled: 0 });
			const agents = db.select().from(schema.agents).all();
			const agent = agents[0];

			const result = await client.callTool({
				name: "execute_agent",
				arguments: { id: agent.id },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Agent is disabled");
			expect(data.guidance).toContain("update_agent");
			expect(mockExecuteAgent).not.toHaveBeenCalled();
		});

		it("for nonexistent agent returns isError", async () => {
			const result = await client.callTool({
				name: "execute_agent",
				arguments: { id: 999 },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Agent not found");
		});
	});

	// --- Error guidance ---

	describe("error guidance", () => {
		it("all error responses include guidance field", async () => {
			// get_agent with bad ID
			const r1 = await client.callTool({ name: "get_agent", arguments: { id: 999 } });
			expect(parseResult(r1).guidance).toBeTruthy();

			// update_agent with bad ID
			const r2 = await client.callTool({
				name: "update_agent",
				arguments: { id: 999, name: "X" },
			});
			expect(parseResult(r2).guidance).toBeTruthy();

			// delete_agent with bad ID
			const r3 = await client.callTool({
				name: "delete_agent",
				arguments: { id: 999 },
			});
			expect(parseResult(r3).guidance).toBeTruthy();

			// execute_agent with bad ID
			const r4 = await client.callTool({
				name: "execute_agent",
				arguments: { id: 999 },
			});
			expect(parseResult(r4).guidance).toBeTruthy();
		});
	});
});

describe("MCP History Tools", () => {
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

	describe("get_execution_history", () => {
		it("returns execution records for agent (most recent first)", async () => {
			const agent = makeAgent(db, { name: "HistoryAgent" });

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
					status: "failure",
					startedAt: "2026-01-02T00:00:00Z",
				})
				.run();

			const result = await client.callTool({
				name: "get_execution_history",
				arguments: { agentId: agent.id },
			});
			const data = parseResult(result);

			expect(data).toHaveLength(2);
			// Most recent first
			expect(data[0].status).toBe("failure");
			expect(data[1].status).toBe("success");
		});

		it("returns empty array when no executions exist", async () => {
			const agent = makeAgent(db, { name: "NoExecAgent" });

			const result = await client.callTool({
				name: "get_execution_history",
				arguments: { agentId: agent.id },
			});
			const data = parseResult(result);

			expect(data).toEqual([]);
		});

		it("caps limit at 200", async () => {
			const agent = makeAgent(db, { name: "LimitAgent" });

			// Insert 5 rows to verify capping logic works (we can't insert 201+)
			for (let i = 0; i < 5; i++) {
				db.insert(schema.executionHistory)
					.values({
						agentId: agent.id,
						status: "success",
						startedAt: `2026-01-0${i + 1}T00:00:00Z`,
					})
					.run();
			}

			// Request with limit=300 -- should cap at 200 but still return all 5
			const result = await client.callTool({
				name: "get_execution_history",
				arguments: { agentId: agent.id, limit: 300 },
			});
			const data = parseResult(result);

			expect(data).toHaveLength(5); // only 5 exist, so all returned
		});

		it("respects limit parameter", async () => {
			const agent = makeAgent(db, { name: "LimitedAgent" });

			for (let i = 0; i < 5; i++) {
				db.insert(schema.executionHistory)
					.values({
						agentId: agent.id,
						status: "success",
						startedAt: `2026-01-0${i + 1}T00:00:00Z`,
					})
					.run();
			}

			const result = await client.callTool({
				name: "get_execution_history",
				arguments: { agentId: agent.id, limit: 2 },
			});
			const data = parseResult(result);

			expect(data).toHaveLength(2);
		});

		it("returns isError with guidance for nonexistent agent", async () => {
			const result = await client.callTool({
				name: "get_execution_history",
				arguments: { agentId: 999 },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("Agent not found");
			expect(data.guidance).toContain("list_agents");
		});
	});
});
