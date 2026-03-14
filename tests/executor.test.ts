import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type Mock,
} from "vitest";
import * as schema from "../src/db/schema.js";

// Mock AI SDK modules before any imports that use them
const mockGenerateText = vi.fn();
const mockAnthropicFn = vi.fn(() => "mock-model");

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
}));

vi.mock("@ai-sdk/anthropic", () => ({
	anthropic: (...args: unknown[]) => mockAnthropicFn(...args),
}));

vi.mock("../src/services/prefetch.js", () => ({
	prefetchUrls: vi.fn(async () => new Map<string, string>()),
	buildPrompt: vi.fn((task: string, _ctx: Map<string, string>) => task),
}));

import { prefetchUrls, buildPrompt } from "../src/services/prefetch.js";
import { executeAgent, executeAgents, _resetLlmBreaker } from "../src/services/executor.js";

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
		db = drizzle(sqlite, { schema });

		vi.clearAllMocks();
		_resetLlmBreaker();
		mockGenerateText.mockResolvedValue(makeLlmResult());
	});

	afterEach(() => {
		sqlite.close();
	});

	it("inserts a 'running' execution record before calling LLM", async () => {
		// Make generateText hang so we can inspect the DB state
		let resolveCall: (v: unknown) => void;
		mockGenerateText.mockImplementation(
			() => new Promise((r) => { resolveCall = r; }),
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

		expect(mockAnthropicFn).toHaveBeenCalledWith("claude-haiku-4-20250514");
		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		const callArgs = mockGenerateText.mock.calls[0][0];
		expect(callArgs.system).toBe("You are helpful");
		expect(callArgs.prompt).toBe("Check something");
	});

	it("uses default model claude-sonnet-4-20250514 when agent has no model", async () => {
		const agent = makeAgent(db, { model: null });
		await executeAgent(agent, db);

		expect(mockAnthropicFn).toHaveBeenCalledWith("claude-sonnet-4-20250514");
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
		vi.mocked(prefetchUrls).mockImplementation(
			async () => {
				await new Promise((r) => setTimeout(r, 30));
				return new Map();
			},
		);

		const agent = makeAgent(db);
		await executeAgent(agent, db);

		const rows = db
			.select()
			.from(schema.executionHistory)
			.where(eq(schema.executionHistory.agentId, agent.id))
			.all();
		expect(rows[0].durationMs).toBeGreaterThanOrEqual(25);
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
		db = drizzle(sqlite, { schema });

		vi.clearAllMocks();
		_resetLlmBreaker();
		mockGenerateText.mockResolvedValue(makeLlmResult());
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
