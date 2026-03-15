import { sql } from "drizzle-orm";
import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const agents = sqliteTable(
	"agents",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		name: text("name").notNull(),
		taskDescription: text("task_description").notNull(),
		cronSchedule: text("cron_schedule").notNull(),
		systemPrompt: text("system_prompt"),
		model: text("model"),
		enabled: integer("enabled").notNull().default(1),
		maxExecutionMs: integer("max_execution_ms"),
		createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	},
	(table) => [uniqueIndex("agents_name_nocase").on(sql`${table.name} COLLATE NOCASE`)],
);

export const executionHistory = sqliteTable(
	"execution_history",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		agentId: integer("agent_id").references(() => agents.id, {
			onDelete: "set null",
		}),
		status: text("status", { enum: ["success", "failure", "running"] }).notNull(),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		durationMs: integer("duration_ms"),
		result: text("result", { mode: "json" }),
		error: text("error"),
		deliveryStatus: text("delivery_status"),
		estimatedCost: real("estimated_cost"),
		retryCount: integer("retry_count").default(0),
		toolCalls: text("tool_calls", { mode: "json" }),
		startedAt: text("started_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
		completedAt: text("completed_at"),
	},
	(table) => [
		index("idx_exec_agent_id").on(table.agentId),
		index("idx_exec_agent_started").on(table.agentId, table.startedAt),
		index("idx_exec_status").on(table.status),
	],
);

export const tools = sqliteTable("tools", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull(),
	description: text("description").notNull(),
	url: text("url").notNull(),
	method: text("method", {
		enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
	})
		.notNull()
		.default("POST"),
	headers: text("headers", { mode: "json" }),
	inputSchema: text("input_schema", { mode: "json" }).notNull(),
	createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const agentTools = sqliteTable(
	"agent_tools",
	{
		agentId: integer("agent_id")
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		toolId: integer("tool_id")
			.notNull()
			.references(() => tools.id, { onDelete: "cascade" }),
		createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	},
	(table) => [uniqueIndex("agent_tools_unique").on(table.agentId, table.toolId)],
);
