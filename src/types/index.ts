import type { agents, executionHistory } from "../db/schema.js";

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Execution = typeof executionHistory.$inferSelect;
export type NewExecution = typeof executionHistory.$inferInsert;

export type AgentResponse = Omit<Agent, "enabled"> & {
	enabled: boolean;
	nextRunAt: string | null;
	lastRunAt: string | null;
};
