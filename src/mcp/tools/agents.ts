import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/index.js";
import { agents } from "../../db/schema.js";
import { isCronExpression } from "../../helpers/cron-detect.js";
import { enrichAgent } from "../../helpers/enrich-agent.js";
import { executeAgent } from "../../services/executor.js";
import { parseSchedule } from "../../services/schedule-parser.js";
import { errorResponse, jsonResponse } from "../helpers.js";

/**
 * Register all agent management MCP tools on the server.
 * Tools: list_agents, get_agent, create_agent, update_agent, delete_agent, execute_agent
 */
export function registerAgentTools(server: McpServer, db: Database): void {
	// --- list_agents ---
	server.registerTool(
		"list_agents",
		{
			title: "List Agents",
			description:
				"List all Schedoodle agents. Returns enriched agent data with health status, next run time, and consecutive failures.",
			inputSchema: z.object({
				enabled: z
					.enum(["true", "false"])
					.optional()
					.describe("Filter by enabled status. Omit to list all agents."),
			}),
		},
		async ({ enabled }) => {
			const list =
				enabled === "true"
					? db.select().from(agents).where(eq(agents.enabled, 1)).all()
					: enabled === "false"
						? db.select().from(agents).where(eq(agents.enabled, 0)).all()
						: db.select().from(agents).all();

			return jsonResponse(list.map((a) => enrichAgent(a, db)));
		},
	);

	// --- get_agent ---
	server.registerTool(
		"get_agent",
		{
			title: "Get Agent",
			description:
				"Get a single agent by ID with enriched data (health status, next run time, schedule info).",
			inputSchema: z.object({
				id: z.number().describe("Agent ID"),
			}),
		},
		async ({ id }) => {
			const agent = db.select().from(agents).where(eq(agents.id, id)).get();
			if (!agent) {
				return errorResponse(
					"Agent not found",
					`Agent with ID ${id} does not exist. Use list_agents to see available agents.`,
				);
			}
			return jsonResponse(enrichAgent(agent, db));
		},
	);

	// --- create_agent ---
	server.registerTool(
		"create_agent",
		{
			title: "Create Agent",
			description:
				"Create a new Schedoodle agent. Accepts cron expressions or natural language schedules (e.g., 'every weekday at 9am').",
			inputSchema: z.object({
				name: z.string().describe("Agent name"),
				taskDescription: z.string().describe("What the agent should do"),
				cronSchedule: z
					.string()
					.describe(
						"Cron expression or natural language schedule (e.g., 'every weekday at 9am')",
					),
				systemPrompt: z.string().optional().describe("System prompt to shape LLM behavior"),
				model: z.string().optional().describe("LLM model ID"),
				enabled: z
					.boolean()
					.default(true)
					.describe("Whether the agent should be enabled"),
			}),
		},
		async ({ name, taskDescription, cronSchedule, systemPrompt, model, enabled }) => {
			// Resolve NL schedule to cron expression
			let resolvedCron = cronSchedule;
			if (!isCronExpression(cronSchedule)) {
				try {
					const parsed = await parseSchedule(cronSchedule);
					resolvedCron = parsed.cronExpression;
				} catch {
					return errorResponse(
						"Could not parse schedule",
						"Provide a valid cron expression (e.g., '0 9 * * 1-5') or a natural language description (e.g., 'every weekday at 9am').",
					);
				}
			}

			const now = new Date().toISOString();
			try {
				const created = db
					.insert(agents)
					.values({
						name,
						taskDescription,
						cronSchedule: resolvedCron,
						systemPrompt: systemPrompt ?? null,
						model: model ?? null,
						enabled: enabled ? 1 : 0,
						createdAt: now,
						updatedAt: now,
					})
					.returning()
					.get();

				return jsonResponse({
					message: "Agent created successfully",
					agent: enrichAgent(created, db),
				});
			} catch (err) {
				if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
					return errorResponse(
						"Agent name already exists",
						`An agent named "${name}" already exists. Use a different name or update the existing agent with update_agent.`,
					);
				}
				throw err;
			}
		},
	);

	// --- update_agent ---
	server.registerTool(
		"update_agent",
		{
			title: "Update Agent",
			description: "Update an existing agent. Only provided fields are modified.",
			inputSchema: z.object({
				id: z.number().describe("Agent ID to update"),
				name: z.string().optional().describe("New agent name"),
				taskDescription: z.string().optional().describe("New task description"),
				cronSchedule: z
					.string()
					.optional()
					.describe(
						"New cron expression or natural language schedule",
					),
				systemPrompt: z.string().optional().describe("New system prompt"),
				model: z.string().optional().describe("New LLM model ID"),
				enabled: z.boolean().optional().describe("Enable or disable the agent"),
			}),
		},
		async ({ id, name, taskDescription, cronSchedule, systemPrompt, model, enabled }) => {
			const existing = db.select().from(agents).where(eq(agents.id, id)).get();
			if (!existing) {
				return errorResponse(
					"Agent not found",
					`Agent with ID ${id} does not exist. Use list_agents to see available agents.`,
				);
			}

			// Resolve NL schedule if provided
			let resolvedCron = cronSchedule;
			if (cronSchedule && !isCronExpression(cronSchedule)) {
				try {
					const parsed = await parseSchedule(cronSchedule);
					resolvedCron = parsed.cronExpression;
				} catch {
					return errorResponse(
						"Could not parse schedule",
						"Provide a valid cron expression or a natural language description.",
					);
				}
			}

			// Build update set with only provided fields
			const updateSet: Record<string, unknown> = {
				updatedAt: new Date().toISOString(),
			};
			if (name !== undefined) updateSet.name = name;
			if (taskDescription !== undefined) updateSet.taskDescription = taskDescription;
			if (resolvedCron !== undefined) updateSet.cronSchedule = resolvedCron;
			if (systemPrompt !== undefined) updateSet.systemPrompt = systemPrompt;
			if (model !== undefined) updateSet.model = model;
			if (enabled !== undefined) updateSet.enabled = enabled ? 1 : 0;

			const updated = db
				.update(agents)
				.set(updateSet)
				.where(eq(agents.id, id))
				.returning()
				.get();

			return jsonResponse(enrichAgent(updated, db));
		},
	);

	// --- delete_agent ---
	server.registerTool(
		"delete_agent",
		{
			title: "Delete Agent",
			description:
				"Delete an agent. First call shows what will be deleted. Call again with confirm=true to execute deletion.",
			inputSchema: z.object({
				id: z.number().describe("Agent ID to delete"),
				confirm: z
					.boolean()
					.default(false)
					.describe("Set to true to confirm deletion. Default shows preview only."),
			}),
			annotations: {
				destructiveHint: true,
			},
		},
		async ({ id, confirm }) => {
			const agent = db.select().from(agents).where(eq(agents.id, id)).get();
			if (!agent) {
				return errorResponse(
					"Agent not found",
					`Agent with ID ${id} does not exist. Use list_agents to see available agents.`,
				);
			}

			if (!confirm) {
				const enriched = enrichAgent(agent, db);
				return jsonResponse({
					action: "delete_agent",
					preview: enriched,
					message: `This will permanently delete agent "${agent.name}" (ID: ${id}) and all its execution history. Call delete_agent again with confirm=true to proceed.`,
				});
			}

			db.delete(agents).where(eq(agents.id, id)).run();
			return jsonResponse({
				deleted: true,
				agentId: id,
				agentName: agent.name,
			});
		},
	);

	// --- execute_agent ---
	server.registerTool(
		"execute_agent",
		{
			title: "Execute Agent",
			description:
				"Trigger synchronous execution of an agent. The agent runs immediately and returns the full result. May take 10-60 seconds.",
			inputSchema: z.object({
				id: z.number().describe("Agent ID to execute"),
			}),
		},
		async ({ id }) => {
			const agent = db.select().from(agents).where(eq(agents.id, id)).get();
			if (!agent) {
				return errorResponse(
					"Agent not found",
					`Agent with ID ${id} does not exist. Use list_agents to see available agents.`,
				);
			}

			if (agent.enabled === 0) {
				return errorResponse(
					"Agent is disabled",
					"Enable the agent first using update_agent with enabled=true before executing.",
				);
			}

			const result = await executeAgent(agent, db);
			return jsonResponse(result);
		},
	);
}
