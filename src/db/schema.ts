import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
		createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	},
	(table) => [uniqueIndex("agents_name_nocase").on(sql`${table.name} COLLATE NOCASE`)],
);

export const executionHistory = sqliteTable("execution_history", {
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
	startedAt: text("started_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	completedAt: text("completed_at"),
});
