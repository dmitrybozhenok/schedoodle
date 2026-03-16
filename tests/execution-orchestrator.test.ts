import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema.js";

// Mock AI SDK modules
const mockGenerateText = vi.fn();
const mockResolveModel = vi.fn(() => "mock-model");
const mockStepCountIs = vi.fn((n: number) => ({ type: "step-count", count: n }));

vi.mock("ai", () => ({
	generateText: (...args: unknown[]) => mockGenerateText(...args),
	Output: {
		object: vi.fn(({ schema: s }: { schema: unknown }) => ({
			type: "object",
			schema: s,
		})),
	},
	NoObjectGeneratedError: {
		isInstance: (err: unknown) =>
			err instanceof Error && (err as Error & { _isNoObject?: boolean })._isNoObject === true,
	},
	stepCountIs: (n: number) => mockStepCountIs(n),
}));

const mockBuildToolSet = vi.fn(() => ({}));
vi.mock("../src/services/tools/registry.js", () => ({
	buildToolSet: (...args: unknown[]) => mockBuildToolSet(...args),
}));

vi.mock("../src/config/llm-provider.js", () => ({
	DEFAULT_MODEL: "claude-sonnet-4-20250514",
	resolveModel: (...args: unknown[]) => mockResolveModel(...args),
}));

vi.mock("../src/services/prefetch.js", () => ({
	prefetchUrls: vi.fn(async () => new Map<string, string>()),
	buildPrompt: vi.fn((task: string, _ctx: Map<string, string>) => task),
}));

const mockDispatchNotifications = vi.fn(async () => {});
vi.mock("../src/services/notifier.js", () => ({
	dispatchNotifications: (...args: unknown[]) => mockDispatchNotifications(...args),
	sendNotification: vi.fn(),
	sendFailureNotification: vi.fn(),
	sendTelegramNotification: vi.fn(),
	sendTelegramFailureNotification: vi.fn(),
}));

import { CircuitBreakerOpenError } from "../src/services/circuit-breaker.js";
import { executeAgentCore } from "../src/services/execution-orchestrator.js";

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

function makeLlmResult(overrides: Record<string, unknown> = {}) {
	return {
		output: { summary: "test summary", details: "test details" },
		usage: { inputTokens: 10, outputTokens: 20 },
		...overrides,
	};
}

function makeBreaker() {
	return {
		execute: async <T>(action: () => Promise<T>) => action(),
	};
}

describe("executeAgentCore", () => {
	let sqlite: Database.Database;
	let db: ReturnType<typeof drizzle>;

	beforeEach(() => {
		sqlite = new Database(":memory:");
		sqlite.exec(CREATE_AGENTS_SQL);
		sqlite.exec(CREATE_EXECUTION_HISTORY_SQL);
		sqlite.exec(CREATE_TOOLS_SQL);
		sqlite.exec(CREATE_AGENT_TOOLS_SQL);
		db = drizzle(sqlite, { schema });

		vi.clearAllMocks();
		mockGenerateText.mockResolvedValue(makeLlmResult());
		mockBuildToolSet.mockReturnValue({});
		mockDispatchNotifications.mockResolvedValue(undefined);
	});

	afterEach(() => {
		sqlite.close();
	});

	it("successful execution: calls insertRunningRecord, LLM, recordSuccess, dispatchNotifications", async () => {
		const agent = makeAgent(db);
		const result = await executeAgentCore(agent, db, makeBreaker());

		expect(result.status).toBe("success");
		expect(result.executionId).toBeGreaterThan(0);

		// Verify DB record
		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe("success");

		// Verify dispatchNotifications was called with success payload
		expect(mockDispatchNotifications).toHaveBeenCalledTimes(1);
		const [payload] = mockDispatchNotifications.mock.calls[0];
		expect(payload.type).toBe("success");
		expect(payload.agentName).toBe("TestAgent");
	});

	it("failed execution (LLM throws): calls recordFailure, dispatchNotifications with failure", async () => {
		mockGenerateText.mockRejectedValue(new Error("LLM failed"));

		const agent = makeAgent(db);
		const result = await executeAgentCore(agent, db, makeBreaker());

		expect(result.status).toBe("failure");
		expect(result.error).toContain("LLM failed");

		// Verify DB record
		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();
		expect(rows[0].status).toBe("failure");
		expect(rows[0].error).toContain("LLM failed");

		// Verify dispatchNotifications was called with failure payload
		expect(mockDispatchNotifications).toHaveBeenCalledTimes(1);
		const [payload] = mockDispatchNotifications.mock.calls[0];
		expect(payload.type).toBe("failure");
		expect(payload.errorMsg).toContain("LLM failed");
	});

	it("circuit breaker open: records failure with 'Circuit breaker open - call rejected'", async () => {
		const openBreaker = {
			execute: async <T>(_action: () => Promise<T>): Promise<T> => {
				throw new CircuitBreakerOpenError("test-breaker");
			},
		};

		const agent = makeAgent(db);
		const result = await executeAgentCore(agent, db, openBreaker);

		expect(result.status).toBe("failure");
		expect(result.error).toBe("Circuit breaker open - call rejected");

		// Verify DB record has estimatedCost 0
		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();
		expect(rows[0].status).toBe("failure");
		expect(rows[0].estimatedCost).toBe(0);
	});

	it("clears timeout in finally block", async () => {
		const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
		const agent = makeAgent(db);
		await executeAgentCore(agent, db, makeBreaker());

		expect(clearTimeoutSpy).toHaveBeenCalled();
		clearTimeoutSpy.mockRestore();
	});

	it("uses DEFAULT_EXECUTION_TIMEOUT_MS when agent has no maxExecutionMs", async () => {
		const agent = makeAgent(db, { maxExecutionMs: undefined });

		let capturedSignal: AbortSignal | undefined;
		mockGenerateText.mockImplementation(async (opts: { abortSignal?: AbortSignal }) => {
			capturedSignal = opts.abortSignal;
			return makeLlmResult();
		});

		await executeAgentCore(agent, db, makeBreaker());

		expect(capturedSignal).toBeDefined();
		expect(capturedSignal?.aborted).toBe(false);
	});
});
