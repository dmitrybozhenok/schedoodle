import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

export function securityHeaders(): MiddlewareHandler {
	return secureHeaders({
		xFrameOptions: "DENY",
		referrerPolicy: "same-origin",
	});
}

export function corsMiddleware(): MiddlewareHandler {
	return cors({
		origin: () => "",
	});
}
