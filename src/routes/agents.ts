import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Database } from "../db/index.js";
import { agents, executionHistory } from "../db/schema.js";
import { enrichAgent } from "../helpers/enrich-agent.js";
import { isCronExpression } from "../helpers/cron-detect.js";
import { createAgentSchema, updateAgentSchema } from "../schemas/agent-input.js";
import { executeAgent } from "../services/executor.js";
import { parseSchedule } from "../services/schedule-parser.js";
import { removeAgent, scheduleAgent } from "../services/scheduler.js";

/**
 * Resolve a schedule string: if it's already a valid cron expression, return it as-is.
 * Otherwise, parse it as natural language via the LLM.
 * Returns { cronSchedule, humanReadable } on success, or throws on failure.
 */
async function resolveSchedule(input: string): Promise<{ cronSchedule: string; humanReadable: string }> {
	if (isCronExpression(input)) {
		return { cronSchedule: input, humanReadable: "" };
	}
	const result = await parseSchedule(input);
	return { cronSchedule: result.cronExpression, humanReadable: result.humanReadable };
}

/**
 * Zod validation error hook: maps issues to { field, message } details array.
 */
function zodErrorHook(
	result: {
		success: boolean;
		error?: { issues: Array<{ path: (string | number)[]; message: string }> };
	},
	c: { json: (data: unknown, status: number) => Response },
) {
	if (!result.success) {
		const details = result.error!.issues.map((issue) => ({
			field: issue.path.join("."),
			message: issue.message,
		}));
		return c.json({ error: "Validation failed", details }, 400);
	}
}

/**
 * Parse and validate an agent ID from the URL parameter.
 * Returns the numeric ID or null if invalid.
 */
function parseId(raw: string): number | null {
	const id = Number(raw);
	return Number.isNaN(id) || !Number.isInteger(id) ? null : id;
}

/**
 * Factory function to create agent routes with injected dependencies.
 * Makes testing possible with in-memory DB and mocked scheduler.
 */
export function createAgentRoutes(db: Database): Hono {
	const app = new Hono();

	// POST / - Create agent
	app.post("/", zValidator("json", createAgentSchema, zodErrorHook as never), async (c) => {
		const data = c.req.valid("json" as never) as {
			name: string;
			taskDescription: string;
			cronSchedule: string;
			systemPrompt?: string;
			model?: string;
			enabled?: boolean;
		};
		const now = new Date().toISOString();

		// Resolve NL schedule to cron expression
		let resolvedCron: string;
		let scheduleNote: string | undefined;
		try {
			const resolved = await resolveSchedule(data.cronSchedule);
			resolvedCron = resolved.cronSchedule;
			scheduleNote = resolved.humanReadable || undefined;
		} catch {
			return c.json(
				{
					error: "Could not parse schedule",
					message:
						"Unable to interpret the schedule. Provide a cron expression (e.g., '0 9 * * 1-5') or a natural language description (e.g., 'every weekday at 9am').",
				},
				422,
			);
		}

		try {
			const created = db
				.insert(agents)
				.values({
					name: data.name,
					taskDescription: data.taskDescription,
					cronSchedule: resolvedCron,
					systemPrompt: data.systemPrompt ?? null,
					model: data.model ?? null,
					enabled: data.enabled === false ? 0 : 1,
					createdAt: now,
					updatedAt: now,
				})
				.returning()
				.get();

			if (created.enabled === 1) {
				scheduleAgent(created, db);
			}

			const enriched = enrichAgent(created, db);
			return c.json(scheduleNote ? { ...enriched, scheduleNote } : enriched, 201);
		} catch (err) {
			// Handle UNIQUE constraint violation for duplicate name
			if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
				return c.json({ error: "Agent name already exists" }, 409);
			}
			throw err;
		}
	});

	// GET / - List all agents (supports ?enabled=true/false filtering)
	app.get("/", (c) => {
		const enabledParam = c.req.query("enabled");
		let list;
		if (enabledParam === "true") {
			list = db.select().from(agents).where(eq(agents.enabled, 1)).all();
		} else if (enabledParam === "false") {
			list = db.select().from(agents).where(eq(agents.enabled, 0)).all();
		} else {
			list = db.select().from(agents).all();
		}
		return c.json(list.map((a) => enrichAgent(a, db)));
	});

	// GET /:id - Get single agent
	app.get("/:id", (c) => {
		const id = parseId(c.req.param("id"));
		if (id === null) {
			return c.json({ error: "Invalid agent ID" }, 400);
		}

		const agent = db.select().from(agents).where(eq(agents.id, id)).get();

		if (!agent) {
			return c.json({ error: "Agent not found" }, 404);
		}

		return c.json(enrichAgent(agent, db));
	});

	// PATCH /:id - Update agent (partial)
	app.patch("/:id", zValidator("json", updateAgentSchema, zodErrorHook as never), async (c) => {
		const id = parseId(c.req.param("id"));
		if (id === null) {
			return c.json({ error: "Invalid agent ID" }, 400);
		}

		// Check agent exists
		const existing = db.select().from(agents).where(eq(agents.id, id)).get();

		if (!existing) {
			return c.json({ error: "Agent not found" }, 404);
		}

		const data = c.req.valid("json" as never) as {
			name?: string;
			taskDescription?: string;
			cronSchedule?: string;
			systemPrompt?: string;
			model?: string;
			enabled?: boolean;
		};

		// Resolve NL schedule if cronSchedule is being updated
		if (data.cronSchedule) {
			try {
				const resolved = await resolveSchedule(data.cronSchedule);
				data.cronSchedule = resolved.cronSchedule;
			} catch {
				return c.json(
					{
						error: "Could not parse schedule",
						message:
							"Unable to interpret the schedule. Provide a cron expression or a natural language description.",
					},
					422,
				);
			}
		}

		// Build the update set, converting boolean enabled to integer for DB
		const updateSet: Record<string, unknown> = {
			...data,
			updatedAt: new Date().toISOString(),
		};
		if (data.enabled !== undefined) {
			updateSet.enabled = data.enabled ? 1 : 0;
		}

		const updated = db
			.update(agents)
			.set(updateSet)
			.where(eq(agents.id, id))
			.returning()
			.get();

		// Reschedule/remove if enabled or cronSchedule changed
		if (data.enabled !== undefined || data.cronSchedule !== undefined) {
			if (updated.enabled === 1) {
				scheduleAgent(updated, db);
			} else {
				removeAgent(updated.id);
			}
		}

		return c.json(enrichAgent(updated, db));
	});

	// DELETE /:id - Delete agent
	app.delete("/:id", (c) => {
		const id = parseId(c.req.param("id"));
		if (id === null) {
			return c.json({ error: "Invalid agent ID" }, 400);
		}

		const existing = db.select().from(agents).where(eq(agents.id, id)).get();

		if (!existing) {
			return c.json({ error: "Agent not found" }, 404);
		}

		removeAgent(id);
		db.delete(agents).where(eq(agents.id, id)).run();

		return c.body(null, 204);
	});

	// POST /:id/execute - Manually trigger agent execution
	app.post("/:id/execute", async (c) => {
		const id = parseId(c.req.param("id"));
		if (id === null) {
			return c.json({ error: "Invalid agent ID" }, 400);
		}

		const agent = db.select().from(agents).where(eq(agents.id, id)).get();

		if (!agent) {
			return c.json({ error: "Agent not found" }, 404);
		}

		const result = await executeAgent(agent, db);
		return c.json(result, result.status === "success" ? 200 : 500);
	});

	// GET /:id/executions - Get execution history for agent
	app.get("/:id/executions", (c) => {
		const id = parseId(c.req.param("id"));
		if (id === null) {
			return c.json({ error: "Invalid agent ID" }, 400);
		}

		// Check agent exists
		const agent = db.select().from(agents).where(eq(agents.id, id)).get();

		if (!agent) {
			return c.json({ error: "Agent not found" }, 404);
		}

		// Parse limit (default 100, cap at 200)
		const rawLimit = c.req.query("limit");
		let limit = 100;
		if (rawLimit !== undefined) {
			const parsed = Number(rawLimit);
			if (!Number.isNaN(parsed) && parsed > 0) {
				limit = Math.min(parsed, 200);
			}
		}

		const list = db
			.select()
			.from(executionHistory)
			.where(eq(executionHistory.agentId, id))
			.orderBy(desc(executionHistory.startedAt))
			.limit(limit)
			.all();

		return c.json(list);
	});

	return app;
}
