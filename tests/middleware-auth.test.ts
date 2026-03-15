import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted so mockEnv is available when vi.mock factory runs (hoisted)
const { mockEnv } = vi.hoisted(() => {
	const mockEnv: Record<string, string | undefined> = {};
	return { mockEnv };
});

vi.mock("../src/config/env.js", () => ({
	env: new Proxy(mockEnv, {
		get: (_target, prop: string) => mockEnv[prop],
	}),
}));

import { authMiddleware } from "../src/middleware/auth.js";

function createApp() {
	const app = new Hono();
	app.use(authMiddleware());
	app.get("/test", (c) => c.json({ ok: true }));
	return app;
}

describe("auth middleware", () => {
	beforeEach(() => {
		// Reset all mock env properties
		for (const key of Object.keys(mockEnv)) {
			delete mockEnv[key];
		}
	});

	describe("when AUTH_TOKEN is set", () => {
		beforeEach(() => {
			mockEnv.AUTH_TOKEN = "secret-token-123";
		});

		it("blocks request without Authorization header -> 401", async () => {
			const app = createApp();
			const res = await app.request("/test");
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body).toEqual({ error: "Unauthorized" });
		});

		it("blocks request with wrong token -> 401", async () => {
			const app = createApp();
			const res = await app.request("/test", {
				headers: { Authorization: "Bearer wrong-token" },
			});
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body).toEqual({ error: "Unauthorized" });
		});

		it("blocks request with malformed Authorization header (no Bearer prefix) -> 401", async () => {
			const app = createApp();
			const res = await app.request("/test", {
				headers: { Authorization: "secret-token-123" },
			});
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body).toEqual({ error: "Unauthorized" });
		});

		it("passes request with correct Bearer token -> 200", async () => {
			const app = createApp();
			const res = await app.request("/test", {
				headers: { Authorization: "Bearer secret-token-123" },
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ ok: true });
		});
	});

	describe("when AUTH_TOKEN is not configured", () => {
		it("skips auth and passes all requests -> 200", async () => {
			const app = createApp();
			const res = await app.request("/test");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ ok: true });
		});
	});
});
