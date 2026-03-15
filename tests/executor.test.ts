import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import * as schema from "../src/db/schema.js";

// Mock AI SDK modules before any imports that use them
const mockGenerateText = vi.fn();
const mockResolveModel = vi.fn(() => "mock-model");
const mockStepCountIs = vi.fn((n: number) => ({ type: "step-count", count: n }));

vi.mock("ai", () => ({
	generateText: (...args: unknown[]) => mockGenerateText(...args),
	Output: {
		object: vi.fn(({ schema }: { schema: unknown }) => ({
			type: "object",
			schema,
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

const mockSendNotification = vi.fn();
vi.mock("../src/services/notifier.js", () => ({
	sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

import { _resetLlmBreaker, _resetLlmSemaphore, drainLlmSemaphore, executeAgent, executeAgents, getLlmSemaphoreStatus } from "../src/services/executor.js";
import { buildPrompt, prefetchUrls } from "../src/services/prefetch.js";

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

function makeNoObjectError(message = "Validation failed"): Error {
	const err = new Error(message) as Error & { _isNoObject: boolean };
	err._isNoObject = true;
	return err;
}

describe("executeAgent", () => {
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
		_resetLlmBreaker();
		_resetLlmSemaphore();
		mockGenerateText.mockResolvedValue(makeLlmResult());
		mockSendNotification.mockResolvedValue({ status: "skipped" });
		mockBuildToolSet.mockReturnValue({});
	});

	afterEach(() => {
		sqlite.close();
	});

	it("inserts a 'running' execution record before calling LLM", async () => {
		// Make generateText hang so we can inspect the DB state
		let resolveCall: (v: unknown) => void;
		mockGenerateText.mockImplementation(
			() =>
				new Promise((r) => {
					resolveCall = r;
				}),
		);

		const agent = makeAgent(db);
		const promise = executeAgent(agent, db);

		// Give it a tick to insert
		await new Promise((r) => setTimeout(r, 10));

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe("running");

		// Resolve so the promise completes
		resolveCall!(makeLlmResult());
		await promise;
	});

	it("calls generateText with agent model (or default), system prompt, and built prompt", async () => {
		const agent = makeAgent(db, {
			model: "claude-haiku-4-20250514",
			systemPrompt: "You are helpful",
			taskDescription: "Check something",
		});

		await executeAgent(agent, db);

		expect(mockResolveModel).toHaveBeenCalledWith("claude-haiku-4-20250514");
		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		const callArgs = mockGenerateText.mock.calls[0][0];
		expect(callArgs.system).toBe("You are helpful");
		expect(callArgs.prompt).toBe("Check something");
	});

	it("uses default model claude-sonnet-4-20250514 when agent has no model", async () => {
		const agent = makeAgent(db, { model: null });
		await executeAgent(agent, db);

		expect(mockResolveModel).toHaveBeenCalledWith("claude-sonnet-4-20250514");
	});

	it("updates execution to 'success' with result, token counts, and duration", async () => {
		const agent = makeAgent(db);

		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe("success");
		expect(rows[0].inputTokens).toBe(10);
		expect(rows[0].outputTokens).toBe(20);
		expect(rows[0].durationMs).toBeGreaterThanOrEqual(0);
		expect(rows[0].result).toEqual({
			summary: "test summary",
			details: "test details",
		});
		expect(rows[0].completedAt).toBeTruthy();
	});

	it("returns { status: 'success', executionId, output } on success", async () => {
		const agent = makeAgent(db);
		const result = await executeAgent(agent, db);

		expect(result.status).toBe("success");
		expect(result.executionId).toBeGreaterThan(0);
		expect(result.output).toEqual({
			summary: "test summary",
			details: "test details",
		});
	});

	it("retries once when NoObjectGeneratedError occurs, appending validation error to prompt", async () => {
		mockGenerateText
			.mockRejectedValueOnce(makeNoObjectError("schema mismatch"))
			.mockResolvedValueOnce(makeLlmResult());

		const agent = makeAgent(db, { taskDescription: "do stuff" });
		const result = await executeAgent(agent, db);

		expect(mockGenerateText).toHaveBeenCalledTimes(2);
		// Second call should have the validation error appended
		const secondCallPrompt = mockGenerateText.mock.calls[1][0].prompt;
		expect(secondCallPrompt).toContain("schema mismatch");
		expect(result.status).toBe("success");
	});

	it("marks execution as 'failure' with error message when retry also fails", async () => {
		mockGenerateText
			.mockRejectedValueOnce(makeNoObjectError("first fail"))
			.mockRejectedValueOnce(makeNoObjectError("second fail"));

		const agent = makeAgent(db);
		const result = await executeAgent(agent, db);

		expect(result.status).toBe("failure");
		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();
		expect(rows[0].status).toBe("failure");
		expect(rows[0].error).toContain("second fail");
	});

	it("marks execution as 'failure' on non-validation errors without retry", async () => {
		mockGenerateText.mockRejectedValue(new Error("API key invalid"));

		const agent = makeAgent(db);
		const result = await executeAgent(agent, db);

		expect(mockGenerateText).toHaveBeenCalledTimes(1); // no retry
		expect(result.status).toBe("failure");
		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();
		expect(rows[0].status).toBe("failure");
		expect(rows[0].error).toContain("API key invalid");
	});

	it("returns { status: 'failure', executionId, error } on any failure", async () => {
		mockGenerateText.mockRejectedValue(new Error("boom"));

		const agent = makeAgent(db);
		const result = await executeAgent(agent, db);

		expect(result.status).toBe("failure");
		expect(result.executionId).toBeGreaterThan(0);
		expect(result.error).toContain("boom");
	});

	it("calls prefetchUrls and buildPrompt to include pre-fetched data in the LLM prompt", async () => {
		const contextMap = new Map([["https://example.com", "fetched content"]]);
		vi.mocked(prefetchUrls).mockResolvedValue(contextMap);
		vi.mocked(buildPrompt).mockReturnValue("enriched prompt");

		const agent = makeAgent(db, { taskDescription: "Check https://example.com" });
		await executeAgent(agent, db);

		expect(prefetchUrls).toHaveBeenCalledWith("Check https://example.com");
		expect(buildPrompt).toHaveBeenCalledWith("Check https://example.com", contextMap);
		expect(mockGenerateText.mock.calls[0][0].prompt).toBe("enriched prompt");
	});

	it("records durationMs covering prefetch + LLM call time", async () => {
		vi.mocked(prefetchUrls).mockImplementation(async () => {
			await new Promise((r) => setTimeout(r, 30));
			return new Map();
		});

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();
		expect(rows[0].durationMs).toBeGreaterThanOrEqual(25);
	});

	it("records retryCount=0 in DB on success without retry", async () => {
		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows[0].retryCount).toBe(0);
	});

	it("records retryCount=1 in DB on success after NoObjectGeneratedError retry", async () => {
		mockGenerateText
			.mockRejectedValueOnce(makeNoObjectError("schema mismatch"))
			.mockResolvedValueOnce(makeLlmResult());

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows[0].retryCount).toBe(1);
	});

	it("records retryCount=0 in DB on failure", async () => {
		mockGenerateText.mockRejectedValue(new Error("API failure"));

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows[0].retryCount).toBe(0);
	});

	it("records estimatedCost in execution history on success", async () => {
		// Default model is claude-sonnet-4-20250514: $3/MTok input, $15/MTok output
		// 10 input tokens + 20 output tokens => 10/1e6*3 + 20/1e6*15 = 0.00003 + 0.0003 = 0.00033
		mockGenerateText.mockResolvedValue(
			makeLlmResult({ usage: { inputTokens: 1000, outputTokens: 500 } }),
		);

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows[0].estimatedCost).toBeTypeOf("number");
		expect(rows[0].estimatedCost).toBeGreaterThan(0);
		// 1000/1e6*3 + 500/1e6*15 = 0.003 + 0.0075 = 0.0105
		expect(rows[0].estimatedCost).toBeCloseTo(0.0105, 4);
	});

	it("records CircuitBreakerOpenError as failure with estimatedCost 0", async () => {
		// Trip the circuit breaker by causing 3 consecutive failures
		mockGenerateText.mockRejectedValue(new Error("API down"));

		for (let i = 0; i < 3; i++) {
			const agent = makeAgent(db, { name: `FailAgent${i}` });
			await executeAgent(agent, db);
		}

		// 4th call should be rejected by circuit breaker without calling generateText
		mockGenerateText.mockClear();
		const agent = makeAgent(db, { name: "BlockedAgent" });
		const result = await executeAgent(agent, db);

		expect(result.status).toBe("failure");
		expect(result.error).toBe("Circuit breaker open - call rejected");
		expect(mockGenerateText).not.toHaveBeenCalled();

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows[0].estimatedCost).toBe(0);
	});

	it("circuit breaker trips after consecutive failures and rejects fast", async () => {
		// First 3 calls fail (trips the breaker)
		mockGenerateText.mockRejectedValue(new Error("service unavailable"));

		for (let i = 0; i < 3; i++) {
			const agent = makeAgent(db, { name: `Fail${i}` });
			await executeAgent(agent, db);
		}

		expect(mockGenerateText).toHaveBeenCalledTimes(3);

		// 4th call: circuit is open, should not call generateText at all
		mockGenerateText.mockClear();
		const agent = makeAgent(db, { name: "Rejected" });
		const start = Date.now();
		const result = await executeAgent(agent, db);
		const elapsed = Date.now() - start;

		expect(result.status).toBe("failure");
		expect(result.error).toBe("Circuit breaker open - call rejected");
		expect(mockGenerateText).not.toHaveBeenCalled();
		// Should be near-instant (< 50ms)
		expect(elapsed).toBeLessThan(50);
	});
});

describe("executeAgents", () => {
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
		_resetLlmBreaker();
		_resetLlmSemaphore();
		mockGenerateText.mockResolvedValue(makeLlmResult());
		mockSendNotification.mockResolvedValue({ status: "skipped" });
		mockBuildToolSet.mockReturnValue({});
	});

	afterEach(() => {
		sqlite.close();
	});

	it("runs multiple agents concurrently via Promise.allSettled", async () => {
		const agent1 = makeAgent(db, { name: "Agent1" });
		const agent2 = makeAgent(db, { name: "Agent2" });

		const results = await executeAgents([agent1, agent2], db);

		expect(results).toHaveLength(2);
		// Both should have fulfilled
		for (const r of results) {
			expect(r.status).toBe("fulfilled");
		}
	});

	it("one agent failing does not prevent other agents from completing successfully", async () => {
		const agent1 = makeAgent(db, { name: "GoodAgent" });
		const agent2 = makeAgent(db, { name: "BadAgent" });

		let callCount = 0;
		mockGenerateText.mockImplementation(async () => {
			callCount++;
			if (callCount === 2) {
				throw new Error("LLM exploded");
			}
			return makeLlmResult();
		});

		const results = await executeAgents([agent1, agent2], db);

		expect(results).toHaveLength(2);
		// Both should be fulfilled (executeAgent catches errors internally)
		const values = results
			.filter((r): r is PromiseFulfilledResult<unknown> => r.status === "fulfilled")
			.map((r) => r.value as { status: string });

		// One success, one failure -- but both settled, not rejected
		const statuses = values.map((v) => v.status).sort();
		expect(statuses).toEqual(["failure", "success"]);
	});
});

describe("notification integration", () => {
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
		_resetLlmBreaker();
		_resetLlmSemaphore();
		mockGenerateText.mockResolvedValue(makeLlmResult());
		mockSendNotification.mockResolvedValue({ status: "sent" });
		mockBuildToolSet.mockReturnValue({});
	});

	afterEach(() => {
		sqlite.close();
	});

	it("calls sendNotification after successful execution", async () => {
		const agent = makeAgent(db);
		await executeAgent(agent, db);

		expect(mockSendNotification).toHaveBeenCalledTimes(1);
		expect(mockSendNotification).toHaveBeenCalledWith(agent.name, expect.any(String), {
			summary: "test summary",
			details: "test details",
		});
	});

	it("sets deliveryStatus to sent on successful notification", async () => {
		mockSendNotification.mockResolvedValue({ status: "sent" });

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows[0].deliveryStatus).toBe("sent");
	});

	it("sets deliveryStatus to failed when notification fails", async () => {
		mockSendNotification.mockResolvedValue({ status: "failed", error: "domain not verified" });

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows[0].deliveryStatus).toBe("failed");
	});

	it("does not update deliveryStatus when notification skipped", async () => {
		mockSendNotification.mockResolvedValue({ status: "skipped" });

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		// When skipped, deliveryStatus should be null (no notification attempted)
		expect(rows[0].deliveryStatus).toBeNull();
	});

	it("does not call sendNotification on failed execution", async () => {
		mockGenerateText.mockRejectedValue(new Error("LLM failed"));

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		expect(mockSendNotification).not.toHaveBeenCalled();
	});

	it("returns success even when sendNotification throws", async () => {
		mockSendNotification.mockRejectedValue(new Error("unexpected crash"));

		const agent = makeAgent(db);
		const result = await executeAgent(agent, db);

		expect(result.status).toBe("success");

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows[0].deliveryStatus).toBe("failed");
	});
});

describe("tool-enabled execution", () => {
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
		_resetLlmBreaker();
		_resetLlmSemaphore();
		mockGenerateText.mockResolvedValue(makeLlmResult());
		mockSendNotification.mockResolvedValue({ status: "skipped" });
		mockBuildToolSet.mockReturnValue({});
	});

	afterEach(() => {
		sqlite.close();
	});

	it("passes tools and stopWhen: stepCountIs(10) to generateText when tools present", async () => {
		const fakeToolSet = { web_fetch: { execute: vi.fn() }, web_search: { execute: vi.fn() } };
		mockBuildToolSet.mockReturnValue(fakeToolSet);

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const callArgs = mockGenerateText.mock.calls[0][0];
		expect(callArgs.tools).toBe(fakeToolSet);
		expect(callArgs.stopWhen).toEqual({ type: "step-count", count: 10 });
		expect(mockStepCountIs).toHaveBeenCalledWith(10);
	});

	it("does not pass tools or stopWhen when tool set is empty", async () => {
		mockBuildToolSet.mockReturnValue({});

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const callArgs = mockGenerateText.mock.calls[0][0];
		expect(callArgs.tools).toBeUndefined();
		expect(callArgs.stopWhen).toBeUndefined();
	});

	it("passes abortSignal to generateText from AbortController", async () => {
		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const callArgs = mockGenerateText.mock.calls[0][0];
		expect(callArgs.abortSignal).toBeDefined();
		expect(callArgs.abortSignal).toBeInstanceOf(AbortSignal);
	});

	it("creates AbortController with timeout from agent.maxExecutionMs", async () => {
		const agent = makeAgent(db, { maxExecutionMs: 5000 });

		// Capture the abortSignal passed to generateText
		let capturedSignal: AbortSignal | undefined;
		mockGenerateText.mockImplementation(async (opts: { abortSignal?: AbortSignal }) => {
			capturedSignal = opts.abortSignal;
			return makeLlmResult();
		});

		await executeAgent(agent, db);

		expect(capturedSignal).toBeDefined();
		// The signal should not be aborted immediately
		expect(capturedSignal!.aborted).toBe(false);
	});

	it("uses default 60000ms timeout when agent.maxExecutionMs is null", async () => {
		const agent = makeAgent(db, { maxExecutionMs: undefined });

		let capturedSignal: AbortSignal | undefined;
		mockGenerateText.mockImplementation(async (opts: { abortSignal?: AbortSignal }) => {
			capturedSignal = opts.abortSignal;
			return makeLlmResult();
		});

		await executeAgent(agent, db);

		// Just verify signal exists -- we can't directly inspect the timeout value
		// but the abort controller was created (signal is not null)
		expect(capturedSignal).toBeDefined();
		expect(capturedSignal!.aborted).toBe(false);
	});

	it("clears timeout in finally block (no leaked timers)", async () => {
		const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
		const agent = makeAgent(db);
		await executeAgent(agent, db);

		expect(clearTimeoutSpy).toHaveBeenCalled();
		clearTimeoutSpy.mockRestore();
	});

	it("loads custom tools for the agent from DB and passes to buildToolSet", async () => {
		const agent = makeAgent(db);

		// Insert a custom tool into the DB
		sqlite.exec(`INSERT INTO tools (name, description, url, input_schema) VALUES ('My API', 'Call my api', 'https://api.example.com', '{"type":"object","properties":{"q":{"type":"string"}}}')`);
		const toolRow = sqlite.prepare("SELECT id FROM tools WHERE name = 'My API'").get() as { id: number };

		// Link it to the agent
		sqlite.exec(`INSERT INTO agent_tools (agent_id, tool_id) VALUES (${agent.id}, ${toolRow.id})`);

		await executeAgent(agent, db);

		expect(mockBuildToolSet).toHaveBeenCalledTimes(1);
		const customToolsArg = mockBuildToolSet.mock.calls[0][0];
		expect(customToolsArg).toHaveLength(1);
		expect(customToolsArg[0].name).toBe("My API");
	});

	it("calls buildToolSet with empty array when agent has no custom tools", async () => {
		const agent = makeAgent(db);
		await executeAgent(agent, db);

		expect(mockBuildToolSet).toHaveBeenCalledWith([]);
	});

	it("collects tool call logs via onStepFinish and stores as JSON in execution_history", async () => {
		const fakeToolSet = { web_fetch: { execute: vi.fn() } };
		mockBuildToolSet.mockReturnValue(fakeToolSet);

		mockGenerateText.mockImplementation(async (opts: { onStepFinish?: (step: unknown) => void }) => {
			// Simulate tool call steps
			if (opts.onStepFinish) {
				opts.onStepFinish({
					toolCalls: [{ toolName: "web_fetch", args: { url: "https://example.com" } }],
					toolResults: [{ result: "fetched content" }],
				});
			}
			return makeLlmResult();
		});

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows[0].toolCalls).not.toBeNull();
		const toolCalls = rows[0].toolCalls as Array<{ toolName: string; input: unknown; output: string; durationMs: number }>;
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].toolName).toBe("web_fetch");
		expect(toolCalls[0].input).toEqual({ url: "https://example.com" });
		expect(toolCalls[0].output).toBe("fetched content");
		expect(toolCalls[0].durationMs).toBe(0);
	});

	it("stores null toolCalls when no tools are used", async () => {
		mockBuildToolSet.mockReturnValue({});

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows[0].toolCalls).toBeNull();
	});

	it("uses result.totalUsage for cost tracking when available", async () => {
		mockGenerateText.mockResolvedValue(
			makeLlmResult({
				usage: { inputTokens: 100, outputTokens: 50 },
				totalUsage: { inputTokens: 500, outputTokens: 200 },
			}),
		);

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		// Should use totalUsage (500, 200) not usage (100, 50)
		expect(rows[0].inputTokens).toBe(500);
		expect(rows[0].outputTokens).toBe(200);
	});

	it("falls back to result.usage when totalUsage is not available", async () => {
		mockGenerateText.mockResolvedValue(
			makeLlmResult({ usage: { inputTokens: 100, outputTokens: 50 } }),
		);

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows[0].inputTokens).toBe(100);
		expect(rows[0].outputTokens).toBe(50);
	});

	it("abort timeout produces a failure result with clear error message", async () => {
		const agent = makeAgent(db, { maxExecutionMs: 50 });

		mockGenerateText.mockImplementation(async (opts: { abortSignal?: AbortSignal }) => {
			// Simulate a long-running call that gets aborted
			return new Promise((_resolve, reject) => {
				const timer = setTimeout(() => _resolve(makeLlmResult()), 10_000);
				if (opts.abortSignal) {
					opts.abortSignal.addEventListener("abort", () => {
						clearTimeout(timer);
						const abortError = new Error("The operation was aborted");
						abortError.name = "AbortError";
						reject(abortError);
					});
				}
			});
		});

		const result = await executeAgent(agent, db);

		expect(result.status).toBe("failure");
		expect(result.error).toContain("timed out");

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();

		expect(rows[0].status).toBe("failure");
		expect(rows[0].error).toContain("timed out");
	});

	it("existing retry logic still works with tools parameter", async () => {
		const fakeToolSet = { web_fetch: { execute: vi.fn() } };
		mockBuildToolSet.mockReturnValue(fakeToolSet);

		mockGenerateText
			.mockRejectedValueOnce(makeNoObjectError("schema mismatch"))
			.mockResolvedValueOnce(makeLlmResult());

		const agent = makeAgent(db);
		const result = await executeAgent(agent, db);

		expect(mockGenerateText).toHaveBeenCalledTimes(2);
		// Both calls should have the tools parameter
		expect(mockGenerateText.mock.calls[0][0].tools).toBe(fakeToolSet);
		expect(mockGenerateText.mock.calls[1][0].tools).toBe(fakeToolSet);
		expect(result.status).toBe("success");
	});

	it("circuit breaker still wraps the entire generateText call with tools", async () => {
		const fakeToolSet = { web_fetch: { execute: vi.fn() } };
		mockBuildToolSet.mockReturnValue(fakeToolSet);

		// Trip the circuit breaker
		mockGenerateText.mockRejectedValue(new Error("API down"));
		for (let i = 0; i < 3; i++) {
			const agent = makeAgent(db, { name: `FailAgent${i}` });
			await executeAgent(agent, db);
		}

		// 4th call should be rejected by circuit breaker
		mockGenerateText.mockClear();
		const agent = makeAgent(db, { name: "BlockedAgent" });
		const result = await executeAgent(agent, db);

		expect(result.status).toBe("failure");
		expect(result.error).toBe("Circuit breaker open - call rejected");
		expect(mockGenerateText).not.toHaveBeenCalled();
	});
});

describe("semaphore concurrency wrapping", () => {
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
		_resetLlmBreaker();
		_resetLlmSemaphore();
		mockGenerateText.mockResolvedValue(makeLlmResult());
		mockSendNotification.mockResolvedValue({ status: "skipped" });
		mockBuildToolSet.mockReturnValue({});
	});

	afterEach(() => {
		sqlite.close();
	});

	it("executeAgent acquires semaphore before execution and releases after (verify via getStatus)", async () => {
		let statusDuringExec: ReturnType<typeof getLlmSemaphoreStatus> | null = null;

		mockGenerateText.mockImplementation(async () => {
			statusDuringExec = getLlmSemaphoreStatus();
			return makeLlmResult();
		});

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		// During execution, one slot should be active
		expect(statusDuringExec).not.toBeNull();
		expect(statusDuringExec!.active).toBe(1);

		// After execution, slot should be released
		const statusAfter = getLlmSemaphoreStatus();
		expect(statusAfter.active).toBe(0);
	});

	it("semaphore is released even when executeAgent throws (finally block)", async () => {
		mockGenerateText.mockRejectedValue(new Error("LLM exploded"));

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		// Semaphore should be released despite error
		const status = getLlmSemaphoreStatus();
		expect(status.active).toBe(0);
	});

	it("when slots are full, a log message is emitted", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		// Make generateText block until we release
		let resolveFirst: (v: unknown) => void;
		let resolveSecond: (v: unknown) => void;
		let resolveThird: (v: unknown) => void;
		let callIndex = 0;
		mockGenerateText.mockImplementation(
			() =>
				new Promise((r) => {
					callIndex++;
					if (callIndex === 1) resolveFirst = r;
					else if (callIndex === 2) resolveSecond = r;
					else resolveThird = r;
				}),
		);

		const agent1 = makeAgent(db, { name: "Agent1" });
		const agent2 = makeAgent(db, { name: "Agent2" });
		const agent3 = makeAgent(db, { name: "Agent3" });
		const agent4 = makeAgent(db, { name: "Agent4" });

		// Start 3 agents (fills default limit of 3)
		const p1 = executeAgent(agent1, db);
		const p2 = executeAgent(agent2, db);
		const p3 = executeAgent(agent3, db);

		// Wait for them to acquire slots
		await new Promise((r) => setTimeout(r, 20));

		// 4th agent should trigger the log
		const p4 = executeAgent(agent4, db);
		await new Promise((r) => setTimeout(r, 20));

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("[concurrency] Slot full"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining('agent "Agent4" queued'),
		);

		// Clean up: resolve all
		resolveFirst!(makeLlmResult());
		resolveSecond!(makeLlmResult());
		resolveThird!(makeLlmResult());
		await Promise.all([p1, p2, p3]);

		// The 4th call should now have a slot
		callIndex = 0; // reset so the new mock call gets resolveFirst
		mockGenerateText.mockResolvedValue(makeLlmResult());
		await p4;

		logSpy.mockRestore();
	});

	it("when slots are available, no concurrency log is emitted", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const concurrencyLogs = logSpy.mock.calls.filter((call) =>
			String(call[0]).includes("[concurrency]"),
		);
		expect(concurrencyLogs).toHaveLength(0);

		logSpy.mockRestore();
	});

	it("getLlmSemaphoreStatus() returns current semaphore status", () => {
		const status = getLlmSemaphoreStatus();
		expect(status).toEqual({ active: 0, queued: 0, limit: 3 });
	});

	it("drainLlmSemaphore() clears queued waiters", async () => {
		// Fill all slots
		mockGenerateText.mockImplementation(() => new Promise(() => {})); // never resolves

		const agent1 = makeAgent(db, { name: "A1" });
		const agent2 = makeAgent(db, { name: "A2" });
		const agent3 = makeAgent(db, { name: "A3" });
		const agent4 = makeAgent(db, { name: "A4" });

		executeAgent(agent1, db);
		executeAgent(agent2, db);
		executeAgent(agent3, db);
		await new Promise((r) => setTimeout(r, 20));

		// 4th one should queue
		executeAgent(agent4, db);
		await new Promise((r) => setTimeout(r, 20));

		expect(getLlmSemaphoreStatus().queued).toBe(1);

		const dropped = drainLlmSemaphore();
		expect(dropped).toBe(1);
		expect(getLlmSemaphoreStatus().queued).toBe(0);
	});

	it("_resetLlmSemaphore() resets semaphore state", async () => {
		// Use up a slot
		mockGenerateText.mockImplementation(() => new Promise(() => {})); // never resolves
		const agent = makeAgent(db, { name: "Busy" });
		executeAgent(agent, db);
		await new Promise((r) => setTimeout(r, 20));

		expect(getLlmSemaphoreStatus().active).toBe(1);

		_resetLlmSemaphore();

		const status = getLlmSemaphoreStatus();
		expect(status).toEqual({ active: 0, queued: 0, limit: 3 });
	});
});
