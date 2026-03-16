/**
 * Zod validation error hook for route handlers.
 * Maps Zod issues to { field, message } details array.
 */
export function zodErrorHook(
	result: {
		success: boolean;
		error?: { issues: Array<{ path: (string | number)[]; message: string }> };
	},
	c: { json: (data: unknown, status: number) => Response },
): Response | undefined {
	if (!result.success) {
		const details = result.error?.issues.map((issue) => ({
			field: issue.path.join("."),
			message: issue.message,
		}));
		return c.json({ error: "Validation failed", details }, 400);
	}
}

/**
 * Parse and validate an integer ID from URL parameter.
 * Returns the numeric ID or null if invalid.
 */
export function parseId(raw: string): number | null {
	const id = Number(raw);
	return Number.isNaN(id) || !Number.isInteger(id) ? null : id;
}
