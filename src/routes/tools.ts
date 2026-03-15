import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Database } from "../db/index.js";
import { tools } from "../db/schema.js";
import { createToolSchema, updateToolSchema } from "../schemas/tool-input.js";

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
 * Parse and validate a tool ID from the URL parameter.
 * Returns the numeric ID or null if invalid.
 */
function parseId(raw: string): number | null {
	const id = Number(raw);
	return Number.isNaN(id) || !Number.isInteger(id) ? null : id;
}

/**
 * Factory function to create tool routes with injected database dependency.
 */
export function createToolRoutes(db: Database): Hono {
	const app = new Hono();

	// POST / - Create tool
	app.post("/", zValidator("json", createToolSchema, zodErrorHook as never), (c) => {
		const data = c.req.valid("json" as never) as {
			name: string;
			description: string;
			url: string;
			method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
			headers?: Record<string, string>;
			inputSchema: Record<string, unknown>;
		};

		const now = new Date().toISOString();

		const created = db
			.insert(tools)
			.values({
				name: data.name,
				description: data.description,
				url: data.url,
				method: data.method ?? "POST",
				headers: data.headers ?? null,
				inputSchema: data.inputSchema,
				createdAt: now,
				updatedAt: now,
			})
			.returning()
			.get();

		return c.json(created, 201);
	});

	// GET / - List all tools
	app.get("/", (c) => {
		const list = db.select().from(tools).all();
		return c.json(list);
	});

	// GET /:id - Get single tool
	app.get("/:id", (c) => {
		const id = parseId(c.req.param("id"));
		if (id === null) {
			return c.json({ error: "Invalid tool ID" }, 400);
		}

		const tool = db.select().from(tools).where(eq(tools.id, id)).get();
		if (!tool) {
			return c.json({ error: "Tool not found" }, 404);
		}

		return c.json(tool);
	});

	// PATCH /:id - Update tool (partial)
	app.patch("/:id", zValidator("json", updateToolSchema, zodErrorHook as never), (c) => {
		const id = parseId(c.req.param("id"));
		if (id === null) {
			return c.json({ error: "Invalid tool ID" }, 400);
		}

		const existing = db.select().from(tools).where(eq(tools.id, id)).get();
		if (!existing) {
			return c.json({ error: "Tool not found" }, 404);
		}

		const data = c.req.valid("json" as never) as {
			name?: string;
			description?: string;
			url?: string;
			method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
			headers?: Record<string, string>;
			inputSchema?: Record<string, unknown>;
		};

		const updated = db
			.update(tools)
			.set({
				...data,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(tools.id, id))
			.returning()
			.get();

		return c.json(updated);
	});

	// DELETE /:id - Delete tool
	app.delete("/:id", (c) => {
		const id = parseId(c.req.param("id"));
		if (id === null) {
			return c.json({ error: "Invalid tool ID" }, 400);
		}

		const existing = db.select().from(tools).where(eq(tools.id, id)).get();
		if (!existing) {
			return c.json({ error: "Tool not found" }, 404);
		}

		db.delete(tools).where(eq(tools.id, id)).run();
		return c.body(null, 204);
	});

	return app;
}
