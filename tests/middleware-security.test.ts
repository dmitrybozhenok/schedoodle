import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { corsMiddleware, securityHeaders } from "../src/middleware/security.js";

function createApp() {
	const app = new Hono();
	app.use(securityHeaders());
	app.use(corsMiddleware());
	app.get("/test", (c) => c.json({ ok: true }));
	return app;
}

describe("security headers middleware", () => {
	it("includes X-Frame-Options: DENY", async () => {
		const app = createApp();
		const res = await app.request("/test");
		expect(res.headers.get("X-Frame-Options")).toBe("DENY");
	});

	it("includes X-Content-Type-Options: nosniff", async () => {
		const app = createApp();
		const res = await app.request("/test");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});

	it("includes Referrer-Policy: same-origin", async () => {
		const app = createApp();
		const res = await app.request("/test");
		expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
	});
});

describe("CORS middleware", () => {
	it("does not include Access-Control-Allow-Origin: * for cross-origin request", async () => {
		const app = createApp();
		const res = await app.request("/test", {
			headers: { Origin: "https://evil.example.com" },
		});
		const acaoHeader = res.headers.get("Access-Control-Allow-Origin");
		expect(acaoHeader).not.toBe("*");
		// Should be empty/null or not set at all
		expect(!acaoHeader || acaoHeader === "").toBe(true);
	});

	it("preflight OPTIONS from foreign origin gets no permissive CORS headers", async () => {
		const app = createApp();
		const res = await app.request("/test", {
			method: "OPTIONS",
			headers: {
				Origin: "https://evil.example.com",
				"Access-Control-Request-Method": "POST",
			},
		});
		const acaoHeader = res.headers.get("Access-Control-Allow-Origin");
		expect(!acaoHeader || acaoHeader === "").toBe(true);
	});
});
