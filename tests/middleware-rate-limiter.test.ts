import { Hono } from "hono";
import {
	afterAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";
import {
	_resetRateLimiter,
	rateLimiterMiddleware,
	stopRateLimiterCleanup,
} from "../src/middleware/rate-limiter.js";

function createApp() {
	const app = new Hono();
	app.use(rateLimiterMiddleware());
	app.post("/agents/1/execute", (c) => c.json({ ok: true }));
	app.post("/schedules/parse", (c) => c.json({ ok: true }));
	app.get("/agents", (c) => c.json({ ok: true }));
	return app;
}

describe("rate limiter middleware", () => {
	beforeEach(() => {
		_resetRateLimiter();
	});

	afterAll(() => {
		stopRateLimiterCleanup();
	});

	it("allows requests within the limit", async () => {
		const app = createApp();
		for (let i = 0; i < 10; i++) {
			const res = await app.request("/agents/1/execute", { method: "POST" });
			expect(res.status).toBe(200);
		}
	});

	it("blocks after 10 requests to /agents/:id/execute", async () => {
		const app = createApp();
		for (let i = 0; i < 10; i++) {
			await app.request("/agents/1/execute", { method: "POST" });
		}
		const res = await app.request("/agents/1/execute", { method: "POST" });
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body).toEqual({ error: "Rate limit exceeded" });
	});

	it("blocks after 10 requests to /schedules/parse", async () => {
		const app = createApp();
		for (let i = 0; i < 10; i++) {
			await app.request("/schedules/parse", { method: "POST" });
		}
		const res = await app.request("/schedules/parse", { method: "POST" });
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body).toEqual({ error: "Rate limit exceeded" });
	});

	it("blocks after 60 requests to general endpoint", async () => {
		const app = createApp();
		for (let i = 0; i < 60; i++) {
			const res = await app.request("/agents");
			expect(res.status).toBe(200);
		}
		const res = await app.request("/agents");
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body).toEqual({ error: "Rate limit exceeded" });
	});

	it("tracks different IPs independently", async () => {
		const app = createApp();
		// Exhaust limit for IP-A
		for (let i = 0; i < 10; i++) {
			await app.request("/agents/1/execute", {
				method: "POST",
				headers: { "X-Forwarded-For": "1.2.3.4" },
			});
		}
		// IP-A should be rate-limited
		const resA = await app.request("/agents/1/execute", {
			method: "POST",
			headers: { "X-Forwarded-For": "1.2.3.4" },
		});
		expect(resA.status).toBe(429);

		// IP-B should still be allowed
		const resB = await app.request("/agents/1/execute", {
			method: "POST",
			headers: { "X-Forwarded-For": "5.6.7.8" },
		});
		expect(resB.status).toBe(200);
	});
});
