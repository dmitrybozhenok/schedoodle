import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import type { CircuitBreakerStatus } from "../src/services/circuit-breaker.js";
import * as schema from "../src/db/schema.js";
import { createHealthRoute } from "../src/routes/health.js";

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
  agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
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

describe("GET /health", () => {
	it("returns 200 with all required fields", async () => {
		const db = createTestDb();
		const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
		const startedAt = Date.now() - 5000;
		const app = createHealthRoute(db, getCircuitStatus, startedAt);

		const res = await app.request("/");
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body).toHaveProperty("status", "ok");
		expect(body).toHaveProperty("uptimeMs");
		expect(body.uptimeMs).toBeGreaterThanOrEqual(5000);
		expect(body).toHaveProperty("agentCount", 0);
		expect(body).toHaveProperty("circuitBreaker");
		expect(body).toHaveProperty("recentExecutions");
		expect(body.recentExecutions).toEqual({ success: 0, failure: 0, total: 0 });
	});

	it("agentCount reflects DB state", async () => {
		const db = createTestDb();
		const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
		const startedAt = Date.now();
		const app = createHealthRoute(db, getCircuitStatus, startedAt);

		// Insert 2 agents
		const now = new Date().toISOString();
		db.insert(schema.agents)
			.values({ name: "Agent1", taskDescription: "task1", cronSchedule: "0 * * * *", createdAt: now, updatedAt: now })
			.run();
		db.insert(schema.agents)
			.values({ name: "Agent2", taskDescription: "task2", cronSchedule: "0 * * * *", createdAt: now, updatedAt: now })
			.run();

		const res = await app.request("/");
		const body = await res.json();
		expect(body.agentCount).toBe(2);
	});

	it("recentExecutions counts success/failure correctly", async () => {
		const db = createTestDb();
		const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
		const startedAt = Date.now();
		const app = createHealthRoute(db, getCircuitStatus, startedAt);

		// Insert an agent first
		const now = new Date().toISOString();
		const agent = db
			.insert(schema.agents)
			.values({ name: "Agent1", taskDescription: "task1", cronSchedule: "0 * * * *", createdAt: now, updatedAt: now })
			.returning()
			.get();

		// Insert executions within last 24 hours
		const recentTime = new Date().toISOString();
		db.insert(schema.executionHistory).values({ agentId: agent.id, status: "success", startedAt: recentTime }).run();
		db.insert(schema.executionHistory).values({ agentId: agent.id, status: "success", startedAt: recentTime }).run();
		db.insert(schema.executionHistory).values({ agentId: agent.id, status: "failure", startedAt: recentTime }).run();

		const res = await app.request("/");
		const body = await res.json();
		expect(body.recentExecutions).toEqual({ success: 2, failure: 1, total: 3 });
	});

	it("excludes executions older than 24 hours", async () => {
		const db = createTestDb();
		const getCircuitStatus = vi.fn(() => defaultCircuitStatus());
		const startedAt = Date.now();
		const app = createHealthRoute(db, getCircuitStatus, startedAt);

		const now = new Date().toISOString();
		const agent = db
			.insert(schema.agents)
			.values({ name: "Agent1", taskDescription: "task1", cronSchedule: "0 * * * *", createdAt: now, updatedAt: now })
			.returning()
			.get();

		// Insert one recent and one old execution
		const recentTime = new Date().toISOString();
		const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
		db.insert(schema.executionHistory).values({ agentId: agent.id, status: "success", startedAt: recentTime }).run();
		db.insert(schema.executionHistory).values({ agentId: agent.id, status: "success", startedAt: oldTime }).run();

		const res = await app.request("/");
		const body = await res.json();
		expect(body.recentExecutions).toEqual({ success: 1, failure: 0, total: 1 });
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
		const app = createHealthRoute(db, getCircuitStatus, startedAt);

		const res = await app.request("/");
		const body = await res.json();
		expect(body.circuitBreaker.state).toBe("OPEN");
		expect(body.circuitBreaker.failures).toBe(3);
		expect(body.circuitBreaker.name).toBe("anthropic");
		expect(getCircuitStatus).toHaveBeenCalled();
	});
});
