import type { MiddlewareHandler } from "hono";
import { env } from "../config/env.js";

export function authMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		if (!env.AUTH_TOKEN) {
			await next();
			return;
		}
		const authHeader = c.req.header("Authorization");
		if (
			!authHeader ||
			!authHeader.startsWith("Bearer ") ||
			authHeader.slice(7) !== env.AUTH_TOKEN
		) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		await next();
	};
}
