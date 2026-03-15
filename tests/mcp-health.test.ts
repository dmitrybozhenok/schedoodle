import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema.js";

// Mock executor for health tools
const mockGetLlmCircuitStatus = vi.fn().mockReturnValue({
	state: "CLOSED",
	failures: 0,
	lastFailureTime: null,
	name: "anthropic",
});

const mockGetLlmSemaphoreStatus = vi.fn().mockReturnValue({
	active: 0,
	queued: 0,
	limit: 3,
});

vi.mock("../src/services/executor.js", () => ({
	executeAgent: vi.fn(),
	getLlmCircuitStatus: (...args: unknown[]) => mockGetLlmCircuitStatus(...args),
	getLlmSemaphoreStatus: (...args: unknown[]) => mockGetLlmSemaphoreStatus(...args),
}));

// Mock schedule parser
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
import { registerHealthTools } from "../src/mcp/tools/health.js";
import { registerScheduleTools } from "../src/mcp/tools/schedules.js";
import { CircuitBreakerOpenError } from "../src/services/circuit-breaker.js";

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

function parseResult(result: { content: Array<{ type: string; text?: string }> }) {
	const textContent = result.content.find((c) => c.type === "text");
	return textContent?.text ? JSON.parse(textContent.text) : null;
}

async function createTestEnv(db: DB) {
	const server = new McpServer({ name: "test-health", version: "1.0.0" });
	registerHealthTools(server, db);
	registerScheduleTools(server);

	const client = new Client({ name: "test-client", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

	await server.connect(serverTransport);
	await client.connect(clientTransport);

	return { server, client };
}

describe("MCP Health Tools", () => {
	let sqlite: Database.Database;
	let db: DB;
	let client: Client;
	let server: McpServer;

	beforeEach(async () => {
		sqlite = new Database(":memory:");
		sqlite.pragma("foreign_keys = ON");
		sqlite.exec(CREATE_AGENTS_SQL);
		sqlite.exec(CREATE_EXECUTION_HISTORY_SQL);
		db = drizzle(sqlite, { schema });

		const env = await createTestEnv(db);
		client = env.client;
		server = env.server;
		vi.clearAllMocks();

		// Reset default mock return values
		mockGetLlmCircuitStatus.mockReturnValue({
			state: "CLOSED",
			failures: 0,
			lastFailureTime: null,
			name: "anthropic",
		});
		mockGetLlmSemaphoreStatus.mockReturnValue({
			active: 0,
			queued: 0,
			limit: 3,
		});
	});

	afterEach(async () => {
		await client.close();
		await server.close();
		sqlite.close();
	});

	describe("get_health", () => {
		it("returns ok status with no agents", async () => {
			const result = await client.callTool({ name: "get_health", arguments: {} });
			const data = parseResult(result);

			expect(data.status).toBe("ok");
			expect(data.agentCount).toBe(0);
			expect(data.agents).toEqual([]);
			expect(data.circuitBreaker).toBeDefined();
			expect(data.concurrency).toBeDefined();
			expect(data.recentExecutions).toBeDefined();
			expect(data.upcomingRuns).toContain("Not available");
		});

		it("returns agent breakdown with execution stats", async () => {
			const agent = makeAgent(db, { name: "StatsAgent" });

			// Insert recent executions (within 24h)
			const now = new Date();
			const recentTime = new Date(now.getTime() - 1000 * 60 * 60).toISOString(); // 1 hour ago
			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "success",
					durationMs: 1000,
					startedAt: recentTime,
				})
				.run();
			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "success",
					durationMs: 2000,
					startedAt: recentTime,
				})
				.run();

			const result = await client.callTool({ name: "get_health", arguments: {} });
			const data = parseResult(result);

			expect(data.status).toBe("ok");
			expect(data.agentCount).toBe(1);
			expect(data.agents).toHaveLength(1);
			expect(data.agents[0].agentName).toBe("StatsAgent");
			expect(data.agents[0].successRate).toBe(100);
			expect(data.agents[0].avgDurationMs).toBe(1500);
			expect(data.agents[0].healthy).toBe(true);
			expect(data.agents[0].lastRunAt).toBeTruthy();
			expect(data.agents[0].lastStatus).toBe("success");
		});

		it("returns degraded status with some unhealthy agents", async () => {
			const _healthyAgent = makeAgent(db, { name: "HealthyAgent" });
			const unhealthyAgent = makeAgent(db, { name: "UnhealthyAgent" });
			const _anotherHealthy = makeAgent(db, { name: "AnotherHealthy" });

			// Make unhealthyAgent have 3 consecutive failures
			const recentTime = new Date(Date.now() - 1000 * 60 * 30).toISOString();
			for (let i = 0; i < 3; i++) {
				db.insert(schema.executionHistory)
					.values({
						agentId: unhealthyAgent.id,
						status: "failure",
						startedAt: recentTime,
					})
					.run();
			}

			const result = await client.callTool({ name: "get_health", arguments: {} });
			const data = parseResult(result);

			// 1 out of 3 agents unhealthy = degraded (not > 50%)
			expect(data.status).toBe("degraded");
			const unhealthyStats = data.agents.find(
				(a: { agentName: string }) => a.agentName === "UnhealthyAgent",
			);
			expect(unhealthyStats.healthy).toBe(false);
			expect(unhealthyStats.consecutiveFailures).toBe(3);
		});

		it("returns unhealthy status when circuit breaker is OPEN", async () => {
			makeAgent(db, { name: "Agent1" });

			mockGetLlmCircuitStatus.mockReturnValue({
				state: "OPEN",
				failures: 3,
				lastFailureTime: Date.now(),
				name: "anthropic",
			});

			const result = await client.callTool({ name: "get_health", arguments: {} });
			const data = parseResult(result);

			expect(data.status).toBe("unhealthy");
			expect(data.circuitBreaker.state).toBe("OPEN");
		});

		it("returns unhealthy status when majority of agents are unhealthy", async () => {
			const agent1 = makeAgent(db, { name: "Bad1" });
			const agent2 = makeAgent(db, { name: "Bad2" });
			makeAgent(db, { name: "Good1" });

			// Make 2 out of 3 agents unhealthy (> 50%)
			const recentTime = new Date(Date.now() - 1000 * 60 * 30).toISOString();
			for (const agentId of [agent1.id, agent2.id]) {
				for (let i = 0; i < 3; i++) {
					db.insert(schema.executionHistory)
						.values({ agentId, status: "failure", startedAt: recentTime })
						.run();
				}
			}

			const result = await client.callTool({ name: "get_health", arguments: {} });
			const data = parseResult(result);

			expect(data.status).toBe("unhealthy");
		});
	});
});

describe("MCP Schedule Tools", () => {
	let sqlite: Database.Database;
	let db: DB;
	let client: Client;
	let server: McpServer;

	beforeEach(async () => {
		sqlite = new Database(":memory:");
		sqlite.pragma("foreign_keys = ON");
		sqlite.exec(CREATE_AGENTS_SQL);
		sqlite.exec(CREATE_EXECUTION_HISTORY_SQL);
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

	describe("parse_schedule", () => {
		it("passes through valid cron expressions without LLM", async () => {
			const result = await client.callTool({
				name: "parse_schedule",
				arguments: { input: "0 9 * * 1-5" },
			});
			const data = parseResult(result);

			// For cron expressions, parseSchedule handles them directly
			// The mock won't be called because isCronExpression returns true
			expect(data.cronExpression).toBe("0 9 * * 1-5");
			expect(data.confidence).toBe("high");
			expect(data.humanReadable).toBeTruthy();
		});

		it("converts natural language to cron via mock", async () => {
			mockParseSchedule.mockResolvedValue({
				input: "every weekday at 9am",
				cronExpression: "0 9 * * 1-5",
				humanReadable: "At 09:00, Monday through Friday",
				confidence: "high",
				interpretation: "Every weekday at 9am",
			});

			const result = await client.callTool({
				name: "parse_schedule",
				arguments: { input: "every weekday at 9am" },
			});
			const data = parseResult(result);

			expect(data.cronExpression).toBe("0 9 * * 1-5");
			expect(data.confidence).toBe("high");
			expect(mockParseSchedule).toHaveBeenCalledWith("every weekday at 9am");
		});

		it("returns error with guidance on CircuitBreakerOpenError", async () => {
			mockParseSchedule.mockRejectedValue(new CircuitBreakerOpenError("anthropic"));

			const result = await client.callTool({
				name: "parse_schedule",
				arguments: { input: "every morning" },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toBe("LLM unavailable");
			expect(data.guidance).toContain("cron expression");
		});

		it("returns error with guidance on parse failure", async () => {
			mockParseSchedule.mockRejectedValue(
				new Error("Input is not a recognizable schedule description"),
			);

			const result = await client.callTool({
				name: "parse_schedule",
				arguments: { input: "make me a sandwich" },
			});
			const data = parseResult(result);

			expect(result.isError).toBe(true);
			expect(data.error).toContain("Schedule parsing failed");
			expect(data.guidance).toContain("cron expression");
		});
	});
});
