import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	_resetRateLimiter,
	rateLimiterMiddleware,
	stopRateLimiterCleanup,
} from "../src/middleware/rate-limiter.js";
import { corsMiddleware, securityHeaders } from "../src/middleware/security.js";

// Mock env for auth middleware
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

/**
 * Mounts middleware in the same order as src/index.ts:
 * securityHeaders -> CORS -> rateLimiter -> auth -> routes
 */
function createFullApp() {
	const app = new Hono();
	app.use(securityHeaders());
	app.use(corsMiddleware());
	app.use(rateLimiterMiddleware());
	app.use(authMiddleware());
	app.get("/test", (c) => c.json({ ok: true }));
	app.post("/agents/1/execute", (c) => c.json({ ok: true }));
	return app;
}

describe("middleware integration (full stack)", () => {
	beforeEach(() => {
		for (const key of Object.keys(mockEnv)) {
			delete mockEnv[key];
		}
		_resetRateLimiter();
	});

	afterAll(() => {
		stopRateLimiterCleanup();
	});

	it("authenticated request gets security headers and 200", async () => {
		mockEnv.AUTH_TOKEN = "test-token";
		const app = createFullApp();
		const res = await app.request("/test", {
			headers: { Authorization: "Bearer test-token" },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("X-Frame-Options")).toBe("DENY");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
	});

	it("unauthenticated request gets 401 with security headers", async () => {
		mockEnv.AUTH_TOKEN = "test-token";
		const app = createFullApp();
		const res = await app.request("/test");
		expect(res.status).toBe(401);
		// Security headers should still be present on 401 responses
		expect(res.headers.get("X-Frame-Options")).toBe("DENY");
	});

	it("rate limiter fires before auth — blocks without checking token", async () => {
		mockEnv.AUTH_TOKEN = "test-token";
		const app = createFullApp();
		// Exhaust rate limit on LLM endpoint (10 requests)
		for (let i = 0; i < 10; i++) {
			await app.request("/agents/1/execute", {
				method: "POST",
				headers: { Authorization: "Bearer test-token" },
			});
		}
		// 11th request should get 429, not 401
		const res = await app.request("/agents/1/execute", {
			method: "POST",
			headers: { Authorization: "Bearer test-token" },
		});
		expect(res.status).toBe(429);
	});

	it("rate limiter blocks unauthenticated requests too (defense in depth)", async () => {
		mockEnv.AUTH_TOKEN = "test-token";
		const app = createFullApp();
		// Send 60 unauthenticated requests to general endpoint
		// They'll get 401 from auth but still count toward rate limit
		for (let i = 0; i < 60; i++) {
			const res = await app.request("/test");
			expect(res.status).toBe(401);
		}
		// 61st should get 429 from rate limiter (before auth even runs)
		const res = await app.request("/test");
		expect(res.status).toBe(429);
	});

	it("CORS preflight is not blocked by auth", async () => {
		mockEnv.AUTH_TOKEN = "test-token";
		const app = createFullApp();
		// OPTIONS preflight carries no Authorization header
		const res = await app.request("/test", {
			method: "OPTIONS",
			headers: {
				Origin: "https://evil.example.com",
				"Access-Control-Request-Method": "GET",
			},
		});
		// Should not get 401 — CORS runs before auth
		expect(res.status).not.toBe(401);
	});
});
