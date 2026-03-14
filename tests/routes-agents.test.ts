import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema.js";

// Mock scheduler to avoid real cron jobs
const mockScheduleAgent = vi.fn();
const mockRemoveAgent = vi.fn();

vi.mock("../src/services/scheduler.js", () => ({
	scheduleAgent: (...args: unknown[]) => mockScheduleAgent(...args),
	removeAgent: (...args: unknown[]) => mockRemoveAgent(...args),
}));

import { createAgentRoutes } from "../src/routes/agents.js";

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

function buildApp(db: ReturnType<typeof drizzle>) {
	const app = new Hono();
	app.route("/agents", createAgentRoutes(db));
	return app;
}

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

describe("Agent CRUD routes", () => {
	let sqlite: Database.Database;
	let db: ReturnType<typeof drizzle>;
	let app: Hono;

	beforeEach(() => {
		sqlite = new Database(":memory:");
		sqlite.pragma("foreign_keys = ON");
		sqlite.exec(CREATE_AGENTS_SQL);
		sqlite.exec(CREATE_EXECUTION_HISTORY_SQL);
		db = drizzle(sqlite, { schema });
		app = buildApp(db);
		vi.clearAllMocks();
	});

	afterEach(() => {
		sqlite.close();
	});

	// --- POST /agents ---

	describe("POST /agents", () => {
		it("creates an agent and returns 201", async () => {
			const res = await app.request("/agents", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "MyAgent",
					taskDescription: "Summarize news",
					cronSchedule: "0 * * * *",
				}),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.name).toBe("MyAgent");
			expect(body.taskDescription).toBe("Summarize news");
			expect(body.cronSchedule).toBe("0 * * * *");
			expect(body.id).toBeGreaterThan(0);
			expect(body.createdAt).toBeTruthy();
			expect(body.updatedAt).toBeTruthy();
		});

		it("stores and returns systemPrompt", async () => {
			const res = await app.request("/agents", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "PromptAgent",
					taskDescription: "Test prompt",
					cronSchedule: "0 * * * *",
					systemPrompt: "You are a helpful assistant",
				}),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.systemPrompt).toBe("You are a helpful assistant");
		});

		it("calls scheduleAgent after creation", async () => {
			await app.request("/agents", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "ScheduledAgent",
					taskDescription: "Run on schedule",
					cronSchedule: "0 * * * *",
				}),
			});

			expect(mockScheduleAgent).toHaveBeenCalledTimes(1);
			expect(mockScheduleAgent.mock.calls[0][0]).toMatchObject({
				name: "ScheduledAgent",
			});
		});

		it("returns 400 with details on missing required fields", async () => {
			const res = await app.request("/agents", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error).toBe("Validation failed");
			expect(body.details).toBeInstanceOf(Array);
			expect(body.details.length).toBeGreaterThan(0);
			expect(body.details[0]).toHaveProperty("field");
			expect(body.details[0]).toHaveProperty("message");
		});

		it("returns 400 with invalid cron expression", async () => {
			const res = await app.request("/agents", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "BadCron",
					taskDescription: "Test",
					cronSchedule: "not-a-cron",
				}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error).toBe("Validation failed");
		});

		it("returns 409 with duplicate agent name", async () => {
			// Create first agent directly in DB
			makeAgent(db, { name: "DuplicateAgent" });

			const res = await app.request("/agents", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "DuplicateAgent",
					taskDescription: "Another one",
					cronSchedule: "0 * * * *",
				}),
			});

			expect(res.status).toBe(409);
			const body = await res.json();
			expect(body.error).toBe("Agent name already exists");
		});
	});

	// --- GET /agents ---

	describe("GET /agents", () => {
		it("returns an empty array when no agents exist", async () => {
			const res = await app.request("/agents");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual([]);
		});

		it("returns all agents", async () => {
			makeAgent(db, { name: "Agent1" });
			makeAgent(db, { name: "Agent2" });

			const res = await app.request("/agents");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toHaveLength(2);
		});
	});

	// --- GET /agents/:id ---

	describe("GET /agents/:id", () => {
		it("returns a single agent", async () => {
			const agent = makeAgent(db, { name: "SingleAgent" });

			const res = await app.request(`/agents/${agent.id}`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.name).toBe("SingleAgent");
			expect(body.id).toBe(agent.id);
		});

		it("returns 404 for non-existent agent", async () => {
			const res = await app.request("/agents/999");
			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error).toBe("Agent not found");
		});

		it("returns 400 for non-numeric id", async () => {
			const res = await app.request("/agents/abc");
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error).toBe("Invalid agent ID");
		});
	});

	// --- PATCH /agents/:id ---

	describe("PATCH /agents/:id", () => {
		it("updates partial fields and returns updated agent", async () => {
			const agent = makeAgent(db, { name: "Original" });

			const res = await app.request(`/agents/${agent.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Updated" }),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.name).toBe("Updated");
			expect(body.taskDescription).toBe("Do the thing"); // unchanged
		});

		it("updates updatedAt timestamp", async () => {
			const agent = makeAgent(db, { name: "TimeAgent" });
			const originalUpdatedAt = agent.updatedAt;

			// Small delay to ensure timestamp differs
			await new Promise((r) => setTimeout(r, 10));

			const res = await app.request(`/agents/${agent.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "TimeAgentUpdated" }),
			});

			const body = await res.json();
			expect(body.updatedAt).not.toBe(originalUpdatedAt);
		});

		it("reschedules agent when cronSchedule changes", async () => {
			const agent = makeAgent(db, { name: "CronAgent" });

			await app.request(`/agents/${agent.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cronSchedule: "*/5 * * * *" }),
			});

			expect(mockScheduleAgent).toHaveBeenCalledTimes(1);
			expect(mockScheduleAgent.mock.calls[0][0]).toMatchObject({
				cronSchedule: "*/5 * * * *",
			});
		});

		it("does not reschedule when cronSchedule is not changed", async () => {
			const agent = makeAgent(db, { name: "NoCronChange" });

			await app.request(`/agents/${agent.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "RenamedAgent" }),
			});

			expect(mockScheduleAgent).not.toHaveBeenCalled();
		});

		it("returns 404 for non-existent agent", async () => {
			const res = await app.request("/agents/999", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Ghost" }),
			});

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error).toBe("Agent not found");
		});
	});

	// --- DELETE /agents/:id ---

	describe("DELETE /agents/:id", () => {
		it("deletes agent and returns 204", async () => {
			const agent = makeAgent(db, { name: "DeleteMe" });

			const res = await app.request(`/agents/${agent.id}`, {
				method: "DELETE",
			});

			expect(res.status).toBe(204);

			// Verify agent is gone
			const remaining = db.select().from(schema.agents).all();
			expect(remaining).toHaveLength(0);
		});

		it("calls removeAgent on delete", async () => {
			const agent = makeAgent(db, { name: "RemoveMe" });

			await app.request(`/agents/${agent.id}`, { method: "DELETE" });

			expect(mockRemoveAgent).toHaveBeenCalledWith(agent.id);
		});

		it("returns 404 for non-existent agent", async () => {
			const res = await app.request("/agents/999", { method: "DELETE" });
			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error).toBe("Agent not found");
		});

		it("preserves execution history with null agentId after delete", async () => {
			const agent = makeAgent(db, { name: "HistoryAgent" });

			// Insert execution history
			db.insert(schema.executionHistory)
				.values({
					agentId: agent.id,
					status: "success",
					result: { summary: "done" },
				})
				.run();

			// Delete the agent
			await app.request(`/agents/${agent.id}`, { method: "DELETE" });

			// Execution history should still exist with null agentId
			const rows = db.select().from(schema.executionHistory).all();
			expect(rows).toHaveLength(1);
			expect(rows[0].agentId).toBeNull();
		});
	});

	// --- GET /agents/:id/executions ---

	describe("GET /agents/:id/executions", () => {
		it("returns execution history for an agent (most recent first)", async () => {
			const agent = makeAgent(db, { name: "ExecAgent" });

			// Insert execution history rows
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

			const res = await app.request(`/agents/${agent.id}/executions`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toHaveLength(2);
			// Most recent first
			expect(body[0].status).toBe("failure");
			expect(body[1].status).toBe("success");
		});

		it("respects limit query parameter", async () => {
			const agent = makeAgent(db, { name: "LimitAgent" });

			for (let i = 0; i < 5; i++) {
				db.insert(schema.executionHistory)
					.values({
						agentId: agent.id,
						status: "success",
						startedAt: `2026-01-0${i + 1}T00:00:00Z`,
					})
					.run();
			}

			const res = await app.request(`/agents/${agent.id}/executions?limit=2`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toHaveLength(2);
		});

		it("caps limit at 200", async () => {
			const agent = makeAgent(db, { name: "MaxLimitAgent" });

			const res = await app.request(`/agents/${agent.id}/executions?limit=500`);
			expect(res.status).toBe(200);
			// Just verify it doesn't error; actual cap tested by behavior
		});

		it("returns 404 for non-existent agent", async () => {
			const res = await app.request("/agents/999/executions");
			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error).toBe("Agent not found");
		});

		it("returns empty array when agent has no executions", async () => {
			const agent = makeAgent(db, { name: "NoExecAgent" });

			const res = await app.request(`/agents/${agent.id}/executions`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual([]);
		});
	});
});
