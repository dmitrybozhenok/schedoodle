import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { env } from "./config/env.js";
import { db } from "./db/index.js";
import { agents } from "./db/schema.js";
import { log } from "./helpers/logger.js";
import { authMiddleware } from "./middleware/auth.js";
import { rateLimiterMiddleware, stopRateLimiterCleanup } from "./middleware/rate-limiter.js";
import { corsMiddleware, securityHeaders } from "./middleware/security.js";
import { createAgentRoutes } from "./routes/agents.js";
import { createDashboardRoute } from "./routes/dashboard.js";
import { createHealthRoute } from "./routes/health.js";
import { createManageRoute } from "./routes/manage.js";
import { createScheduleRoutes } from "./routes/schedules.js";
import { createToolRoutes } from "./routes/tools.js";
import {
	drainLlmSemaphore,
	getLlmCircuitStatus,
	getLlmSemaphoreStatus,
} from "./services/executor.js";
import { getScheduledJobs, startAll, stopAll } from "./services/scheduler.js";
import {
	cleanupStaleExecutions,
	markRunningAsShutdownTimeout,
	pruneOldExecutions,
} from "./services/startup.js";
import { handleTelegramMessage } from "./services/telegram-commands.js";
import { startPolling, stopPolling } from "./services/telegram-poller.js";

const startedAt = Date.now();

let shuttingDown = false;

export function isShuttingDown(): boolean {
	return shuttingDown;
}

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
	log.error(`Unhandled error: ${err}`);
	return c.json({ error: "Internal server error" }, 500);
});

// Not found handler
app.notFound((c) => {
	return c.json({ error: "Not found" }, 404);
});

// Mount routes
app.route("/agents", createAgentRoutes(db, isShuttingDown));
app.route(
	"/health",
	createHealthRoute(
		db,
		getLlmCircuitStatus,
		startedAt,
		getScheduledJobs,
		getLlmSemaphoreStatus,
		isShuttingDown,
	),
);
app.route("/manage", createManageRoute());
app.route("/schedules", createScheduleRoutes());
app.route("/dashboard", createDashboardRoute());
app.route("/tools", createToolRoutes(db));

// Boot sequence: stale cleanup -> pruning -> scheduler
const staleCount = cleanupStaleExecutions(db);
if (staleCount > 0) {
	log.startup.info(`Cleaned up ${staleCount} stale running executions`);
}

const prunedCount = pruneOldExecutions(db, env.RETENTION_DAYS);
if (prunedCount > 0) {
	log.startup.info(`Pruned ${prunedCount} execution records older than ${env.RETENTION_DAYS} days`);
}

const allAgents = db.select().from(agents).all();
startAll(allAgents, db);

// Start Telegram bot polling (if configured)
if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
	startPolling(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, (msg) =>
		handleTelegramMessage(msg, db),
	);
	log.telegram.info("Polling started");
}

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	log.info(`Schedoodle listening on port ${info.port}`);
});

// Graceful shutdown
async function shutdown() {
	if (shuttingDown) return;
	shuttingDown = true;
	log.info("Schedoodle shutting down...");
	stopRateLimiterCleanup();
	stopAll();
	stopPolling();
	server.close();

	const dropped = drainLlmSemaphore();
	if (dropped > 0) {
		log.shutdown.info(`Dropped ${dropped} queued execution(s)`);
	}

	const status = getLlmSemaphoreStatus();
	if (status.active > 0) {
		log.shutdown.info(
			`Waiting for ${status.active} in-flight executions to complete (30s timeout)...`,
		);
		const deadline = Date.now() + 30_000;
		while (getLlmSemaphoreStatus().active > 0 && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 500));
		}
		if (getLlmSemaphoreStatus().active > 0) {
			const staleCount = markRunningAsShutdownTimeout(db);
			log.shutdown.info(`Timeout exceeded, marked ${staleCount} execution(s) as failed`);
		} else {
			log.shutdown.info("All executions complete, exiting");
		}
	}
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { app };
