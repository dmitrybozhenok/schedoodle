import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { env } from "./config/env.js";
import { authMiddleware } from "./middleware/auth.js";
import {
	rateLimiterMiddleware,
	stopRateLimiterCleanup,
} from "./middleware/rate-limiter.js";
import { corsMiddleware, securityHeaders } from "./middleware/security.js";
import { db } from "./db/index.js";
import { agents } from "./db/schema.js";
import { createAgentRoutes } from "./routes/agents.js";
import { createDashboardRoute } from "./routes/dashboard.js";
import { createHealthRoute } from "./routes/health.js";
import { createManageRoute } from "./routes/manage.js";
import { createScheduleRoutes } from "./routes/schedules.js";
import { createToolRoutes } from "./routes/tools.js";
import { getLlmCircuitStatus } from "./services/executor.js";
import { getScheduledJobs, startAll, stopAll } from "./services/scheduler.js";

const startedAt = Date.now();

// Create Hono app
const app = new Hono();

// Request logging middleware
app.use(logger());

// Security middleware (order: headers -> CORS -> rate limit -> auth -> routes)
app.use(securityHeaders());
app.use(corsMiddleware());
app.use(rateLimiterMiddleware());
app.use(authMiddleware());

// Global error handler
app.onError((err, c) => {
	if (err instanceof HTTPException) {
		return c.json({ error: err.message }, err.status);
	}
	console.error("Unhandled error:", err);
	return c.json({ error: "Internal server error" }, 500);
});

// Not found handler
app.notFound((c) => {
	return c.json({ error: "Not found" }, 404);
});

// Mount routes
app.route("/agents", createAgentRoutes(db));
app.route("/health", createHealthRoute(db, getLlmCircuitStatus, startedAt, getScheduledJobs));
app.route("/manage", createManageRoute());
app.route("/schedules", createScheduleRoutes());
app.route("/dashboard", createDashboardRoute());
app.route("/tools", createToolRoutes(db));

// Boot sequence
const allAgents = db.select().from(agents).all();
startAll(allAgents, db);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	console.log(`Schedoodle listening on port ${info.port}`);
});

// Graceful shutdown
function shutdown() {
	console.log("Schedoodle shutting down...");
	stopRateLimiterCleanup();
	stopAll();
	server.close();
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { app };
