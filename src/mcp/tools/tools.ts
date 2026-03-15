import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/index.js";
import { agents, agentTools, tools } from "../../db/schema.js";
import { errorResponse, jsonResponse } from "../helpers.js";

/**
 * Register all tool management MCP tools on the server.
 * Tools: list_tools, get_tool, create_tool, update_tool, delete_tool,
 *        list_agent_tools, attach_tool, detach_tool
 */
export function registerToolTools(server: McpServer, db: Database): void {
	// --- list_tools ---
	server.registerTool(
		"list_tools",
		{
			title: "List Tools",
			description:
				"List all custom tools. Returns tool definitions with their schemas and configurations.",
			inputSchema: z.object({}),
		},
		async () => {
			const allTools = db.select().from(tools).all();
			return jsonResponse(allTools);
		},
	);

	// --- get_tool ---
	server.registerTool(
		"get_tool",
		{
			title: "Get Tool",
			description: "Get a single custom tool by ID with its full schema and configuration.",
			inputSchema: z.object({
				id: z.number().describe("Tool ID"),
			}),
		},
		async ({ id }) => {
			const tool = db.select().from(tools).where(eq(tools.id, id)).get();
			if (!tool) {
				return errorResponse(
					"Tool not found",
					`Tool with ID ${id} does not exist. Use list_tools to see available tools.`,
				);
			}
			return jsonResponse(tool);
		},
	);

	// --- create_tool ---
	server.registerTool(
		"create_tool",
		{
			title: "Create Tool",
			description:
				"Create a new custom tool that agents can use during execution. Define the webhook URL, HTTP method, and input schema.",
			inputSchema: z.object({
				name: z.string().describe("Tool name"),
				description: z.string().describe("What the tool does"),
				url: z.string().describe("Webhook URL"),
				method: z
					.enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
					.default("POST")
					.describe("HTTP method"),
				headers: z
					.record(z.string(), z.string())
					.optional()
					.describe("HTTP headers as key-value pairs"),
				inputSchema: z
					.record(z.string(), z.any())
					.describe("JSON Schema for tool input parameters"),
			}),
		},
		async ({ name, description, url, method, headers, inputSchema: schema }) => {
			const now = new Date().toISOString();
			const created = db
				.insert(tools)
				.values({
					name,
					description,
					url,
					method,
					headers: headers ?? null,
					inputSchema: schema,
					createdAt: now,
					updatedAt: now,
				})
				.returning()
				.get();

			return jsonResponse(created);
		},
	);

	// --- update_tool ---
	server.registerTool(
		"update_tool",
		{
			title: "Update Tool",
			description: "Update an existing custom tool. Only provided fields are modified.",
			inputSchema: z.object({
				id: z.number().describe("Tool ID to update"),
				name: z.string().optional().describe("New tool name"),
				description: z.string().optional().describe("New description"),
				url: z.string().optional().describe("New webhook URL"),
				method: z
					.enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
					.optional()
					.describe("New HTTP method"),
				headers: z.record(z.string(), z.string()).optional().describe("New HTTP headers"),
				inputSchema: z
					.record(z.string(), z.any())
					.optional()
					.describe("New JSON Schema for input parameters"),
			}),
		},
		async ({ id, name, description, url, method, headers, inputSchema: schema }) => {
			const existing = db.select().from(tools).where(eq(tools.id, id)).get();
			if (!existing) {
				return errorResponse(
					"Tool not found",
					`Tool with ID ${id} does not exist. Use list_tools to see available tools.`,
				);
			}

			const updateSet: Record<string, unknown> = {
				updatedAt: new Date().toISOString(),
			};
			if (name !== undefined) updateSet.name = name;
			if (description !== undefined) updateSet.description = description;
			if (url !== undefined) updateSet.url = url;
			if (method !== undefined) updateSet.method = method;
			if (headers !== undefined) updateSet.headers = headers;
			if (schema !== undefined) updateSet.inputSchema = schema;

			const updated = db.update(tools).set(updateSet).where(eq(tools.id, id)).returning().get();

			return jsonResponse(updated);
		},
	);

	// --- delete_tool ---
	server.registerTool(
		"delete_tool",
		{
			title: "Delete Tool",
			description:
				"Delete a custom tool. First call shows what will be deleted. Call again with confirm=true to execute deletion.",
			inputSchema: z.object({
				id: z.number().describe("Tool ID to delete"),
				confirm: z.boolean().default(false).describe("Set to true to confirm deletion"),
			}),
			annotations: {
				destructiveHint: true,
			},
		},
		async ({ id, confirm }) => {
			const tool = db.select().from(tools).where(eq(tools.id, id)).get();
			if (!tool) {
				return errorResponse(
					"Tool not found",
					`Tool with ID ${id} does not exist. Use list_tools to see available tools.`,
				);
			}

			if (!confirm) {
				return jsonResponse({
					action: "delete_tool",
					preview: tool,
					message: `This will permanently delete tool "${tool.name}" (ID: ${id}). Any agents using this tool will lose access. Call delete_tool again with confirm=true to proceed.`,
				});
			}

			db.delete(tools).where(eq(tools.id, id)).run();
			return jsonResponse({
				deleted: true,
				toolId: id,
				toolName: tool.name,
			});
		},
	);

	// --- list_agent_tools ---
	server.registerTool(
		"list_agent_tools",
		{
			title: "List Agent Tools",
			description: "List all custom tools attached to a specific agent.",
			inputSchema: z.object({
				agentId: z.number().describe("Agent ID"),
			}),
		},
		async ({ agentId }) => {
			// Verify agent exists
			const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
			if (!agent) {
				return errorResponse(
					"Agent not found",
					`Agent with ID ${agentId} does not exist. Use list_agents to see available agents.`,
				);
			}

			// Get tool IDs attached to this agent
			const links = db
				.select({ toolId: agentTools.toolId })
				.from(agentTools)
				.where(eq(agentTools.agentId, agentId))
				.all();

			if (links.length === 0) {
				return jsonResponse([]);
			}

			// Fetch full tool records
			const toolIds = links.map((l) => l.toolId);
			const attachedTools = db.select().from(tools).where(inArray(tools.id, toolIds)).all();

			return jsonResponse(attachedTools);
		},
	);

	// --- attach_tool ---
	server.registerTool(
		"attach_tool",
		{
			title: "Attach Tool",
			description: "Attach a custom tool to an agent so the agent can use it during execution.",
			inputSchema: z.object({
				agentId: z.number().describe("Agent ID"),
				toolId: z.number().describe("Tool ID to attach"),
			}),
		},
		async ({ agentId, toolId }) => {
			// Verify agent exists
			const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
			if (!agent) {
				return errorResponse(
					"Agent not found",
					`Agent with ID ${agentId} does not exist. Use list_agents to see available agents.`,
				);
			}

			// Verify tool exists
			const tool = db.select().from(tools).where(eq(tools.id, toolId)).get();
			if (!tool) {
				return errorResponse(
					"Tool not found",
					`Tool with ID ${toolId} does not exist. Use list_tools to see available tools.`,
				);
			}

			try {
				db.insert(agentTools)
					.values({
						agentId,
						toolId,
						createdAt: new Date().toISOString(),
					})
					.run();

				return jsonResponse({ agentId, toolId, attached: true });
			} catch (err) {
				if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
					return errorResponse(
						"Tool already attached",
						`Tool "${tool.name}" is already attached to agent "${agent.name}". Use list_agent_tools to see attached tools.`,
					);
				}
				throw err;
			}
		},
	);

	// --- detach_tool ---
	server.registerTool(
		"detach_tool",
		{
			title: "Detach Tool",
			description: "Detach a custom tool from an agent so the agent no longer uses it.",
			inputSchema: z.object({
				agentId: z.number().describe("Agent ID"),
				toolId: z.number().describe("Tool ID to detach"),
			}),
		},
		async ({ agentId, toolId }) => {
			// Verify the link exists
			const link = db
				.select()
				.from(agentTools)
				.where(eq(agentTools.agentId, agentId))
				.all()
				.find((l) => l.toolId === toolId);

			if (!link) {
				return errorResponse(
					"Tool not attached",
					`Tool ${toolId} is not attached to agent ${agentId}. Use list_agent_tools to see attached tools.`,
				);
			}

			db.delete(agentTools)
				.where(and(eq(agentTools.agentId, agentId), eq(agentTools.toolId, toolId)))
				.run();

			return jsonResponse({ agentId, toolId, detached: true });
		},
	);
}
