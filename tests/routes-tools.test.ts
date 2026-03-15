import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema.js";

import { createToolRoutes } from "../src/routes/tools.js";

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

function buildApp(db: ReturnType<typeof drizzle>) {
	const app = new Hono();
	app.route("/tools", createToolRoutes(db));
	return app;
}

function makeTool(
	db: ReturnType<typeof drizzle>,
	overrides: Partial<{
		name: string;
		description: string;
		url: string;
		method: string;
		headers: Record<string, string>;
		inputSchema: Record<string, unknown>;
	}> = {},
) {
	return db
		.insert(schema.tools)
		.values({
			name: overrides.name ?? "TestTool",
			description: overrides.description ?? "A test tool",
			url: overrides.url ?? "https://example.com/webhook",
			method: overrides.method ?? "POST",
			headers: overrides.headers ?? null,
			inputSchema: overrides.inputSchema ?? { type: "object", properties: {} },
		})
		.returning()
		.get();
}

describe("Tools CRUD routes", () => {
	let sqlite: Database.Database;
	let db: ReturnType<typeof drizzle>;
	let app: Hono;

	beforeEach(() => {
		sqlite = new Database(":memory:");
		sqlite.pragma("foreign_keys = ON");
		sqlite.exec(CREATE_TOOLS_SQL);
		db = drizzle(sqlite, { schema });
		app = buildApp(db);
	});

	afterEach(() => {
		sqlite.close();
	});

	// --- POST /tools ---

	describe("POST /tools", () => {
		it("creates a tool and returns 201", async () => {
			const res = await app.request("/tools", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "MyTool",
					description: "Fetches weather data",
					url: "https://api.weather.com/hook",
					inputSchema: { type: "object", properties: { city: { type: "string" } } },
				}),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.name).toBe("MyTool");
			expect(body.description).toBe("Fetches weather data");
			expect(body.url).toBe("https://api.weather.com/hook");
			expect(body.id).toBeGreaterThan(0);
			expect(body.createdAt).toBeTruthy();
			expect(body.updatedAt).toBeTruthy();
		});

		it("returns 400 with validation errors on missing required fields", async () => {
			const res = await app.request("/tools", {
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

		it("defaults method to POST when not specified", async () => {
			const res = await app.request("/tools", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "DefaultMethod",
					description: "Default method tool",
					url: "https://example.com/hook",
					inputSchema: { type: "object" },
				}),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.method).toBe("POST");
		});

		it("stores headers as JSON object", async () => {
			const headers = { Authorization: "Bearer token123", "Content-Type": "application/json" };
			const res = await app.request("/tools", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "HeaderTool",
					description: "Tool with headers",
					url: "https://example.com/hook",
					inputSchema: { type: "object" },
					headers,
				}),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.headers).toEqual(headers);
		});
	});

	// --- GET /tools ---

	describe("GET /tools", () => {
		it("returns array of all tools", async () => {
			makeTool(db, { name: "Tool1" });
			makeTool(db, { name: "Tool2" });

			const res = await app.request("/tools");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toHaveLength(2);
		});

		it("returns empty array when no tools exist", async () => {
			const res = await app.request("/tools");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual([]);
		});
	});

	// --- GET /tools/:id ---

	describe("GET /tools/:id", () => {
		it("returns single tool by ID", async () => {
			const tool = makeTool(db, { name: "SingleTool" });

			const res = await app.request(`/tools/${tool.id}`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.name).toBe("SingleTool");
			expect(body.id).toBe(tool.id);
		});

		it("returns 404 for non-existent tool", async () => {
			const res = await app.request("/tools/999");
			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error).toBe("Tool not found");
		});

		it("returns 400 for non-numeric ID", async () => {
			const res = await app.request("/tools/abc");
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error).toBe("Invalid tool ID");
		});
	});

	// --- PATCH /tools/:id ---

	describe("PATCH /tools/:id", () => {
		it("updates specified fields and returns updated tool", async () => {
			const tool = makeTool(db, { name: "Original" });

			const res = await app.request(`/tools/${tool.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Updated" }),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.name).toBe("Updated");
			expect(body.description).toBe("A test tool"); // unchanged
		});

		it("returns 404 for non-existent tool", async () => {
			const res = await app.request("/tools/999", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Ghost" }),
			});

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error).toBe("Tool not found");
		});

		it("updates updatedAt timestamp", async () => {
			const tool = makeTool(db, { name: "TimeTool" });
			const originalUpdatedAt = tool.updatedAt;

			// Small delay to ensure timestamp differs
			await new Promise((r) => setTimeout(r, 10));

			const res = await app.request(`/tools/${tool.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "TimeToolUpdated" }),
			});

			const body = await res.json();
			expect(body.updatedAt).not.toBe(originalUpdatedAt);
		});
	});

	// --- DELETE /tools/:id ---

	describe("DELETE /tools/:id", () => {
		it("removes tool and returns 204", async () => {
			const tool = makeTool(db, { name: "DeleteMe" });

			const res = await app.request(`/tools/${tool.id}`, {
				method: "DELETE",
			});

			expect(res.status).toBe(204);

			// Verify tool is gone
			const remaining = db.select().from(schema.tools).all();
			expect(remaining).toHaveLength(0);
		});

		it("returns 404 for non-existent tool", async () => {
			const res = await app.request("/tools/999", { method: "DELETE" });
			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error).toBe("Tool not found");
		});
	});
});
