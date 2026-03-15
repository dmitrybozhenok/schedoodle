import type { Context, MiddlewareHandler } from "hono";

const WINDOW_MS = 60 * 1000; // 1 minute
const LLM_MAX_REQUESTS = 10;
const GENERAL_MAX_REQUESTS = 60;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

const requestLog = new Map<string, number[]>();

function getClientIp(c: Context): string {
	const forwarded = c.req.header("x-forwarded-for");
	if (forwarded) {
		return forwarded.split(",")[0].trim();
	}
	return (
		(c.env as Record<string, unknown>)?.incoming as
			| { socket?: { remoteAddress?: string } }
			| undefined
	)?.socket?.remoteAddress ?? "127.0.0.1";
}

function isRateLimited(
	ip: string,
	windowMs: number,
	maxRequests: number,
): boolean {
	const now = Date.now();
	const timestamps = requestLog.get(ip) ?? [];
	const windowStart = now - windowMs;
	const valid = timestamps.filter((t) => t > windowStart);
	valid.push(now);
	requestLog.set(ip, valid);
	return valid.length > maxRequests;
}

function isLlmEndpoint(path: string): boolean {
	return /^\/agents\/\d+\/execute$/.test(path) || path === "/schedules/parse";
}

export function rateLimiterMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		const ip = getClientIp(c);
		const path = c.req.path;
		const maxRequests = isLlmEndpoint(path)
			? LLM_MAX_REQUESTS
			: GENERAL_MAX_REQUESTS;

		if (isRateLimited(ip, WINDOW_MS, maxRequests)) {
			return c.json({ error: "Rate limit exceeded" }, 429);
		}

		await next();
	};
}

// Cleanup stale entries every 5 minutes
const cleanupTimer = setInterval(() => {
	const cutoff = Date.now() - STALE_THRESHOLD_MS;
	for (const [ip, timestamps] of requestLog) {
		const latest = timestamps[timestamps.length - 1];
		if (!latest || latest < cutoff) {
			requestLog.delete(ip);
		}
	}
}, CLEANUP_INTERVAL_MS);

// Prevent timer from keeping the process alive
if (cleanupTimer.unref) {
	cleanupTimer.unref();
}

export function stopRateLimiterCleanup(): void {
	clearInterval(cleanupTimer);
}

export function _resetRateLimiter(): void {
	requestLog.clear();
}
