/**
 * Shared MCP response formatting utilities.
 * All MCP tool handlers use these to produce consistent JSON responses.
 */

/**
 * Format a successful JSON response for an MCP tool.
 */
export function jsonResponse(data: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
	};
}

/**
 * Format an error response with actionable guidance for self-correction.
 */
export function errorResponse(error: string, guidance: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({ error, guidance }, null, 2),
			},
		],
		isError: true,
	};
}
