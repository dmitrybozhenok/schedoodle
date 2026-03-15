import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema.js";
import { createHealthRoute } from "../src/routes/health.js";
import type { CircuitBreakerStatus } from "../src/services/circuit-breaker.js";

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
`;

function createTestDb() {
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	sqlite.exec(CREATE_AGENTS_SQL);
	sqlite.exec(CREATE_EXECUTION_HISTORY_SQL);
	return db;
}

function defaultCircuitStatus(): CircuitBreakerStatus {
	return {
		state: "CLOSED",
		failures: 0,
		lastFailureTime: null,
		name: "anthropic",
	};
}

function mockGetScheduledJobs(entries: Array<[number, { nextRun: () => Date | null }]> = []) {
	return vi.fn(() => new Map(entries));
}

function insertAgent(db: ReturnType<typeof createTestDb>, name: string, cronSchedule = "0 * * * *") {
	const now = new Date().toISOString();
	return db
		.insert(schema.agents)
		.values({
			name,
			taskDescription: `task for ${name}`,
			cronSchedule,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get();
}

function insertExecution(
	db: ReturnType<typeof createTestDb>,
	agentId: number,
	status: "success" | "failure" | "running",
	opts: {
		startedAt?: string;
		durationMs?: number;
		result?: string;
		error?: string;
	} = {},
) {
	const startedAt = opts.startedAt ?? new Date().toISOString();
	return db
		.insert(schema.executionHistory)
		.values({
			agentId,
			status,
			startedAt,
			durationMs: opts.durationMs ?? null,
			result: opts.result ?? null,
			error: opts.error ?? null,
		})
		.returning()
		.get();
}

describe("GET /health", () => {
	it("returns 200 with all required fields", async () => {
		const db = createTestDb();
		const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
		const startedAt = Date.now() - 5000;
		const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

		const res = await app.request("/");
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body).toHaveProperty("status", "ok");
		expect(body).toHaveProperty("uptimeMs");
		expect(body.uptimeMs).toBeGreaterThanOrEqual(5000);
		expect(body).toHaveProperty("agentCount", 0);
		expect(body).toHaveProperty("circuitBreaker");
		expect(body).toHaveProperty("recentExecutions");
		expect(body.recentExecutions).toMatchObject({ success: 0, failure: 0, total: 0 });
	});

	it("agentCount reflects DB state", async () => {
		const db = createTestDb();
		const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
		const startedAt = Date.now();
		const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

		insertAgent(db, "Agent1");
		insertAgent(db, "Agent2");

		const res = await app.request("/");
		const body = await res.json();
		expect(body.agentCount).toBe(2);
	});

	it("recentExecutions counts success/failure correctly", async () => {
		const db = createTestDb();
		const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
		const startedAt = Date.now();
		const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

		const agent = insertAgent(db, "Agent1");

		const recentTime = new Date().toISOString();
		insertExecution(db, agent.id, "success", { startedAt: recentTime });
		insertExecution(db, agent.id, "success", { startedAt: recentTime });
		insertExecution(db, agent.id, "failure", { startedAt: recentTime });

		const res = await app.request("/");
		const body = await res.json();
		expect(body.recentExecutions).toMatchObject({ success: 2, failure: 1, total: 3 });
	});

	it("excludes executions older than 24 hours", async () => {
		const db = createTestDb();
		const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
		const startedAt = Date.now();
		const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

		const agent = insertAgent(db, "Agent1");

		const recentTime = new Date().toISOString();
		const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
		insertExecution(db, agent.id, "success", { startedAt: recentTime });
		insertExecution(db, agent.id, "success", { startedAt: oldTime });

		const res = await app.request("/");
		const body = await res.json();
		expect(body.recentExecutions).toMatchObject({ success: 1, failure: 0, total: 1 });
	});

	it("includes circuitBreaker status from callback", async () => {
		const db = createTestDb();
		const openStatus: CircuitBreakerStatus = {
			state: "OPEN",
			failures: 3,
			lastFailureTime: Date.now() - 1000,
			name: "anthropic",
		};
		const getCircuitStatus = vi.fn(() => openStatus);
		const startedAt = Date.now();
		const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

		const res = await app.request("/");
		const body = await res.json();
		expect(body.circuitBreaker.state).toBe("OPEN");
		expect(body.circuitBreaker.failures).toBe(3);
		expect(body.circuitBreaker.name).toBe("anthropic");
		expect(getCircuitStatus).toHaveBeenCalled();
	});

	// --- New tests for Plan 08-02 ---

	describe("per-agent breakdown", () => {
		it("returns agents array with all expected fields", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const agent1 = insertAgent(db, "AgentA");
			const agent2 = insertAgent(db, "AgentB");

			const recentTime = new Date().toISOString();
			insertExecution(db, agent1.id, "success", { startedAt: recentTime, durationMs: 1000 });
			insertExecution(db, agent2.id, "failure", { startedAt: recentTime, durationMs: 2000 });

			const res = await app.request("/");
			const body = await res.json();

			expect(body).toHaveProperty("agents");
			expect(body.agents).toHaveLength(2);

			const agentA = body.agents.find((a: Record<string, unknown>) => a.agentName === "AgentA");
			expect(agentA).toBeDefined();
			expect(agentA).toHaveProperty("agentId", agent1.id);
			expect(agentA).toHaveProperty("agentName", "AgentA");
			expect(agentA).toHaveProperty("lastRunAt");
			expect(agentA).toHaveProperty("lastStatus");
			expect(agentA).toHaveProperty("successRate");
			expect(agentA).toHaveProperty("avgDurationMs");
			expect(agentA).toHaveProperty("healthy");
			expect(agentA).toHaveProperty("consecutiveFailures");
		});
	});

	describe("successRate computation", () => {
		it("computes correct successRate for mixed executions", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const agent = insertAgent(db, "MixedAgent");
			const recentTime = new Date().toISOString();
			insertExecution(db, agent.id, "success", { startedAt: recentTime });
			insertExecution(db, agent.id, "success", { startedAt: recentTime });
			insertExecution(db, agent.id, "failure", { startedAt: recentTime });

			const res = await app.request("/");
			const body = await res.json();

			const agentStats = body.agents.find((a: Record<string, unknown>) => a.agentName === "MixedAgent");
			// 2 success / 3 total = 66.67%
			expect(agentStats.successRate).toBeCloseTo(66.67, 1);
		});

		it("returns 100% successRate for agents with zero executions in window", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			insertAgent(db, "NoExecAgent");

			const res = await app.request("/");
			const body = await res.json();

			const agentStats = body.agents.find((a: Record<string, unknown>) => a.agentName === "NoExecAgent");
			expect(agentStats.successRate).toBe(100);
		});

		it("excludes 'running' status from success rate calculation", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const agent = insertAgent(db, "RunningAgent");
			const recentTime = new Date().toISOString();
			insertExecution(db, agent.id, "success", { startedAt: recentTime });
			insertExecution(db, agent.id, "running", { startedAt: recentTime });

			const res = await app.request("/");
			const body = await res.json();

			const agentStats = body.agents.find((a: Record<string, unknown>) => a.agentName === "RunningAgent");
			// 1 success / 1 completed (running excluded) = 100%
			expect(agentStats.successRate).toBe(100);
		});
	});

	describe("avgDurationMs", () => {
		it("computes average duration for agent", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const agent = insertAgent(db, "DurAgent");
			const recentTime = new Date().toISOString();
			insertExecution(db, agent.id, "success", { startedAt: recentTime, durationMs: 1000 });
			insertExecution(db, agent.id, "success", { startedAt: recentTime, durationMs: 3000 });

			const res = await app.request("/");
			const body = await res.json();

			const agentStats = body.agents.find((a: Record<string, unknown>) => a.agentName === "DurAgent");
			expect(agentStats.avgDurationMs).toBe(2000);
		});

		it("returns 0 avgDurationMs for agents with no executions", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			insertAgent(db, "NoDurAgent");

			const res = await app.request("/");
			const body = await res.json();

			const agentStats = body.agents.find((a: Record<string, unknown>) => a.agentName === "NoDurAgent");
			expect(agentStats.avgDurationMs).toBe(0);
		});
	});

	describe("status levels", () => {
		it("returns status ok when all agents healthy and circuit closed", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const agent = insertAgent(db, "HealthyAgent");
			const recentTime = new Date().toISOString();
			insertExecution(db, agent.id, "success", { startedAt: recentTime });

			const res = await app.request("/");
			const body = await res.json();
			expect(body.status).toBe("ok");
		});

		it("returns status degraded when some agents unhealthy", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const agent1 = insertAgent(db, "HealthyAgent1");
			const agent2 = insertAgent(db, "UnhealthyAgent");
			const agent3 = insertAgent(db, "HealthyAgent3");

			const recentTime = new Date().toISOString();
			// agent1: healthy - 1 success
			insertExecution(db, agent1.id, "success", { startedAt: recentTime });
			// agent2: unhealthy - 3 consecutive failures
			insertExecution(db, agent2.id, "failure", { startedAt: recentTime });
			insertExecution(db, agent2.id, "failure", { startedAt: recentTime });
			insertExecution(db, agent2.id, "failure", { startedAt: recentTime });
			// agent3: healthy - 1 success
			insertExecution(db, agent3.id, "success", { startedAt: recentTime });

			const res = await app.request("/");
			const body = await res.json();
			expect(body.status).toBe("degraded");
		});

		it("returns status unhealthy when circuit breaker is OPEN", async () => {
			const db = createTestDb();
			const openStatus: CircuitBreakerStatus = {
				state: "OPEN",
				failures: 5,
				lastFailureTime: Date.now(),
				name: "anthropic",
			};
			const getCircuitStatus = vi.fn(() => openStatus);
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const agent = insertAgent(db, "OkAgent");
			const recentTime = new Date().toISOString();
			insertExecution(db, agent.id, "success", { startedAt: recentTime });

			const res = await app.request("/");
			const body = await res.json();
			expect(body.status).toBe("unhealthy");
		});

		it("returns status unhealthy when majority of agents are failing", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const agent1 = insertAgent(db, "Bad1");
			const agent2 = insertAgent(db, "Bad2");
			const agent3 = insertAgent(db, "Good1");

			const recentTime = new Date().toISOString();
			// agent1: 3 consecutive failures
			insertExecution(db, agent1.id, "failure", { startedAt: recentTime });
			insertExecution(db, agent1.id, "failure", { startedAt: recentTime });
			insertExecution(db, agent1.id, "failure", { startedAt: recentTime });
			// agent2: 3 consecutive failures
			insertExecution(db, agent2.id, "failure", { startedAt: recentTime });
			insertExecution(db, agent2.id, "failure", { startedAt: recentTime });
			insertExecution(db, agent2.id, "failure", { startedAt: recentTime });
			// agent3: healthy
			insertExecution(db, agent3.id, "success", { startedAt: recentTime });

			const res = await app.request("/");
			const body = await res.json();
			expect(body.status).toBe("unhealthy");
		});

		it("returns status ok when there are zero agents", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const res = await app.request("/");
			const body = await res.json();
			expect(body.status).toBe("ok");
		});
	});

	describe("upcoming runs", () => {
		it("returns upcomingRuns array sorted by scheduledAt, limited to 5", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();

			const agent1 = insertAgent(db, "Sched1");
			const agent2 = insertAgent(db, "Sched2");
			const agent3 = insertAgent(db, "Sched3");

			const mockJobs = new Map<number, { nextRun: () => Date | null }>();
			mockJobs.set(agent1.id, { nextRun: () => new Date("2026-03-15T12:00:00Z") });
			mockJobs.set(agent2.id, { nextRun: () => new Date("2026-03-15T09:00:00Z") });
			mockJobs.set(agent3.id, { nextRun: () => new Date("2026-03-15T10:00:00Z") });

			const getScheduledJobs = vi.fn(() => mockJobs);
			const app = createHealthRoute(db, getCircuitStatus, startedAt, getScheduledJobs as ReturnType<typeof mockGetScheduledJobs>);

			const res = await app.request("/");
			const body = await res.json();

			expect(body).toHaveProperty("upcomingRuns");
			expect(body.upcomingRuns).toHaveLength(3);
			// Sorted by scheduledAt ascending
			expect(body.upcomingRuns[0].agentName).toBe("Sched2");
			expect(body.upcomingRuns[1].agentName).toBe("Sched3");
			expect(body.upcomingRuns[2].agentName).toBe("Sched1");
			expect(body.upcomingRuns[0].scheduledAt).toBe("2026-03-15T09:00:00.000Z");
		});

		it("limits upcomingRuns to 5 entries", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();

			// Create 7 agents
			const agentIds: number[] = [];
			for (let i = 0; i < 7; i++) {
				const agent = insertAgent(db, `Agent${i}`);
				agentIds.push(agent.id);
			}

			const mockJobs = new Map<number, { nextRun: () => Date | null }>();
			for (let i = 0; i < 7; i++) {
				mockJobs.set(agentIds[i], { nextRun: () => new Date(`2026-03-15T${String(i + 8).padStart(2, "0")}:00:00Z`) });
			}

			const getScheduledJobs = vi.fn(() => mockJobs);
			const app = createHealthRoute(db, getCircuitStatus, startedAt, getScheduledJobs as ReturnType<typeof mockGetScheduledJobs>);

			const res = await app.request("/");
			const body = await res.json();

			expect(body.upcomingRuns).toHaveLength(5);
		});

		it("handles jobs with null nextRun", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();

			const agent1 = insertAgent(db, "Active1");
			const agent2 = insertAgent(db, "Paused1");

			const mockJobs = new Map<number, { nextRun: () => Date | null }>();
			mockJobs.set(agent1.id, { nextRun: () => new Date("2026-03-15T10:00:00Z") });
			mockJobs.set(agent2.id, { nextRun: () => null }); // paused/stopped

			const getScheduledJobs = vi.fn(() => mockJobs);
			const app = createHealthRoute(db, getCircuitStatus, startedAt, getScheduledJobs as ReturnType<typeof mockGetScheduledJobs>);

			const res = await app.request("/");
			const body = await res.json();

			expect(body.upcomingRuns).toHaveLength(1);
			expect(body.upcomingRuns[0].agentName).toBe("Active1");
		});
	});

	describe("result/error truncation", () => {
		it("truncates long result to 200 chars with ... suffix", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const agent = insertAgent(db, "LongResultAgent");
			const longResult = "A".repeat(300);
			insertExecution(db, agent.id, "success", {
				startedAt: new Date().toISOString(),
				result: longResult,
			});

			const res = await app.request("/");
			const body = await res.json();

			const agentStats = body.agents.find((a: Record<string, unknown>) => a.agentName === "LongResultAgent");
			expect(agentStats.lastResult).toHaveLength(203); // 200 + "..."
			expect(agentStats.lastResult).toMatch(/\.\.\.$/);
		});

		it("truncates long error to 200 chars with ... suffix", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const agent = insertAgent(db, "LongErrorAgent");
			const longError = "E".repeat(300);
			insertExecution(db, agent.id, "failure", {
				startedAt: new Date().toISOString(),
				error: longError,
			});

			const res = await app.request("/");
			const body = await res.json();

			const agentStats = body.agents.find((a: Record<string, unknown>) => a.agentName === "LongErrorAgent");
			expect(agentStats.lastError).toHaveLength(203);
			expect(agentStats.lastError).toMatch(/\.\.\.$/);
		});

		it("does not truncate short result/error", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const agent = insertAgent(db, "ShortAgent");
			insertExecution(db, agent.id, "success", {
				startedAt: new Date().toISOString(),
				result: "short result",
			});

			const res = await app.request("/");
			const body = await res.json();

			const agentStats = body.agents.find((a: Record<string, unknown>) => a.agentName === "ShortAgent");
			expect(agentStats.lastResult).toBe("short result");
		});
	});

	describe("recentExecutions aggregates", () => {
		it("includes successRate and avgDurationMs in recentExecutions", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const agent = insertAgent(db, "AggAgent");
			const recentTime = new Date().toISOString();
			insertExecution(db, agent.id, "success", { startedAt: recentTime, durationMs: 1000 });
			insertExecution(db, agent.id, "success", { startedAt: recentTime, durationMs: 3000 });
			insertExecution(db, agent.id, "failure", { startedAt: recentTime, durationMs: 2000 });

			const res = await app.request("/");
			const body = await res.json();

			expect(body.recentExecutions).toHaveProperty("successRate");
			expect(body.recentExecutions).toHaveProperty("avgDurationMs");
			// 2 success / 3 completed = 66.67%
			expect(body.recentExecutions.successRate).toBeCloseTo(66.67, 1);
			// avg of 1000, 3000, 2000 = 2000
			expect(body.recentExecutions.avgDurationMs).toBe(2000);
		});

		it("returns 100% successRate and 0 avgDurationMs when no recent executions", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now();
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			const res = await app.request("/");
			const body = await res.json();

			expect(body.recentExecutions.successRate).toBe(100);
			expect(body.recentExecutions.avgDurationMs).toBe(0);
		});
	});

	describe("existing fields preserved", () => {
		it("preserves uptimeMs, agentCount, circuitBreaker, recentExecutions counts", async () => {
			const db = createTestDb();
			const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
			const startedAt = Date.now() - 10000;
			const app = createHealthRoute(db, getCircuitStatus, startedAt, mockGetScheduledJobs());

			insertAgent(db, "PreserveAgent");

			const res = await app.request("/");
			const body = await res.json();

			expect(body).toHaveProperty("uptimeMs");
			expect(body.uptimeMs).toBeGreaterThanOrEqual(10000);
			expect(body).toHaveProperty("agentCount", 1);
			expect(body).toHaveProperty("circuitBreaker");
			expect(body.circuitBreaker).toHaveProperty("state", "CLOSED");
			expect(body).toHaveProperty("recentExecutions");
			expect(body.recentExecutions).toHaveProperty("success");
			expect(body.recentExecutions).toHaveProperty("failure");
			expect(body.recentExecutions).toHaveProperty("total");
		});
	});
});
