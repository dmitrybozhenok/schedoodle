import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/index.js";
import { agents, executionHistory } from "../../db/schema.js";
import { errorResponse, jsonResponse } from "../helpers.js";

/**
 * Register execution history MCP tools on the server.
 * Tools: get_execution_history
 */
export function registerHistoryTools(server: McpServer, db: Database): void {
	server.registerTool(
		"get_execution_history",
		{
			title: "Get Execution History",
			description: "Get execution history for an agent. Returns most recent executions first.",
			inputSchema: z.object({
				agentId: z.number().describe("Agent ID"),
				limit: z.number().default(100).describe("Max results (default 100, max 200)"),
			}),
		},
		async ({ agentId, limit }) => {
			// Verify agent exists
			const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
			if (!agent) {
				return errorResponse(
					"Agent not found",
					`Agent with ID ${agentId} does not exist. Use list_agents to see available agents.`,
				);
			}

			// Cap limit at 200
			const cappedLimit = Math.min(limit, 200);

			const history = db
				.select()
				.from(executionHistory)
				.where(eq(executionHistory.agentId, agentId))
				.orderBy(desc(executionHistory.startedAt))
				.limit(cappedLimit)
				.all();

			return jsonResponse(history);
		},
	);
}
