import type { agents, agentTools, executionHistory, tools } from "../db/schema.js";

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Execution = typeof executionHistory.$inferSelect;
export type NewExecution = typeof executionHistory.$inferInsert;
export type Tool = typeof tools.$inferSelect;
export type NewTool = typeof tools.$inferInsert;
export type AgentTool = typeof agentTools.$inferSelect;

export type AgentResponse = Omit<Agent, "enabled"> & {
	enabled: boolean;
	nextRunAt: string | null;
	lastRunAt: string | null;
	healthy: boolean;
	consecutiveFailures: number;
};
