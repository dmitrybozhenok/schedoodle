import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CircuitBreakerOpenError } from "../../services/circuit-breaker.js";
import { parseSchedule } from "../../services/schedule-parser.js";
import { errorResponse, jsonResponse } from "../helpers.js";

/**
 * Register schedule parsing MCP tools on the server.
 * Tools: parse_schedule
 */
export function registerScheduleTools(server: McpServer): void {
	server.registerTool(
		"parse_schedule",
		{
			title: "Parse Schedule",
			description:
				"Convert a natural language schedule description or cron expression into a structured schedule. Returns cron expression, human-readable description, and confidence level.",
			inputSchema: z.object({
				input: z
					.string()
					.describe(
						"Natural language schedule or cron expression (e.g., 'every weekday at 9am' or '0 9 * * 1-5')",
					),
			}),
		},
		async ({ input }) => {
			try {
				const result = await parseSchedule(input);
				return jsonResponse(result);
			} catch (err) {
				if (err instanceof CircuitBreakerOpenError) {
					return errorResponse(
						"LLM unavailable",
						"LLM is unavailable. Use a cron expression directly (e.g., '0 9 * * 1-5').",
					);
				}
				const message = err instanceof Error ? err.message : String(err);
				return errorResponse(
					`Schedule parsing failed: ${message}`,
					"Try a clearer description (e.g., 'every weekday at 9am', 'every 3 hours') or use a cron expression directly (e.g., '0 9 * * 1-5').",
				);
			}
		},
	);
}
