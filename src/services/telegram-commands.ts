import { eq, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import type { Database } from "../db/index.js";
import { agents } from "../db/schema.js";
import { enrichAgent, getConsecutiveFailures } from "../helpers/enrich-agent.js";
import type { Agent } from "../types/index.js";
import { executeAgent, getLlmCircuitStatus } from "./executor.js";
import { parseIntent } from "./intent-parser.js";
import { parseSchedule } from "./schedule-parser.js";
import { getScheduledJobs, removeAgent, scheduleAgent } from "./scheduler.js";
import { sendPlainText, sendTypingAction, type TelegramMessage } from "./telegram-poller.js";

const HELP_TEXT = `I can help you manage your agents. Try:

- "list agents" - show all agents
- "run [agent name]" - execute an agent
- "enable [agent name]" - enable an agent
- "disable [agent name]" - disable an agent
- "status" - system health summary
- "change [agent name] to [schedule]" - update schedule

Commands: /help, /start`;

/**
 * Find an agent by name (case-insensitive).
 */
function findAgentByName(name: string, db: Database): Agent | undefined {
	return db
		.select()
		.from(agents)
		.where(sql`${agents.name} COLLATE NOCASE = ${name} COLLATE NOCASE`)
		.get();
}

/**
 * Return the help/capabilities text.
 */
function handleHelp(): string {
	return HELP_TEXT;
}

/**
 * List all agents with enabled/disabled and healthy/unhealthy status.
 */
function handleList(db: Database): string {
	const allAgents = db.select().from(agents).all();
	if (allAgents.length === 0) return "No agents configured.";

	const lines = allAgents.map((agent, i) => {
		const enriched = enrichAgent(agent, db);
		const enabledStr = enriched.enabled ? "enabled" : "disabled";
		const healthStr = enriched.healthy ? "healthy" : "unhealthy";
		return `${i + 1}. ${agent.name} (${enabledStr}, ${healthStr})`;
	});

	return `Agents:\n${lines.join("\n")}`;
}

/**
 * Run an agent (fire-and-forget). Disabled agents can still be manually executed.
 */
function handleRun(agentName: string, db: Database): string {
	const agent = findAgentByName(agentName, db);
	if (!agent) return `Agent "${agentName}" not found. Try: list agents`;

	void executeAgent(agent, db).catch((err) =>
		console.error(
			`[telegram-bot] Run "${agent.name}" failed: ${err instanceof Error ? err.message : err}`,
		),
	);

	return `Running ${agent.name}...`;
}

/**
 * Enable an agent: update DB and register cron job.
 */
function handleEnable(agentName: string, db: Database): string {
	const agent = findAgentByName(agentName, db);
	if (!agent) return `Agent "${agentName}" not found. Try: list agents`;
	if (agent.enabled === 1) return `${agent.name} is already enabled.`;

	db.update(agents)
		.set({ enabled: 1, updatedAt: new Date().toISOString() })
		.where(eq(agents.id, agent.id))
		.run();

	const updated = db.select().from(agents).where(eq(agents.id, agent.id)).get();
	if (updated) scheduleAgent(updated, db);

	return `Enabled ${agent.name}.`;
}

/**
 * Disable an agent: update DB and unregister cron job.
 */
function handleDisable(agentName: string, db: Database): string {
	const agent = findAgentByName(agentName, db);
	if (!agent) return `Agent "${agentName}" not found. Try: list agents`;
	if (agent.enabled === 0) return `${agent.name} is already disabled.`;

	db.update(agents)
		.set({ enabled: 0, updatedAt: new Date().toISOString() })
		.where(eq(agents.id, agent.id))
		.run();

	removeAgent(agent.id);

	return `Disabled ${agent.name}.`;
}

/**
 * Return a concise system health summary.
 */
function handleStatus(db: Database): string {
	const allAgents = db.select().from(agents).all();
	const enabledCount = allAgents.filter((a) => a.enabled === 1).length;
	const disabledCount = allAgents.length - enabledCount;

	let unhealthyCount = 0;
	for (const agent of allAgents) {
		if (getConsecutiveFailures(agent.id, db) >= 3) unhealthyCount++;
	}
	const healthyCount = allAgents.length - unhealthyCount;

	const cb = getLlmCircuitStatus();
	const jobCount = getScheduledJobs().size;

	let status: string;
	if (cb.state === "OPEN") {
		status = "Unhealthy";
	} else if (unhealthyCount > allAgents.length / 2) {
		status = "Unhealthy";
	} else if (unhealthyCount > 0) {
		status = "Degraded";
	} else {
		status = "OK";
	}

	return [
		`System Status: ${status}`,
		`Agents: ${allAgents.length} total, ${enabledCount} enabled, ${disabledCount} disabled`,
		`Health: ${healthyCount} healthy, ${unhealthyCount} unhealthy`,
		`Scheduled jobs: ${jobCount}`,
		`LLM circuit breaker: ${cb.state}`,
	].join("\n");
}

/**
 * Reschedule an agent using NL-to-cron parser.
 */
async function handleReschedule(
	agentName: string,
	scheduleInput: string,
	db: Database,
): Promise<string> {
	const agent = findAgentByName(agentName, db);
	if (!agent) return `Agent "${agentName}" not found. Try: list agents`;

	try {
		const result = await parseSchedule(scheduleInput);

		db.update(agents)
			.set({
				cronSchedule: result.cronExpression,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(agents.id, agent.id))
			.run();

		if (agent.enabled === 1) {
			const updated = db.select().from(agents).where(eq(agents.id, agent.id)).get();
			if (updated) scheduleAgent(updated, db);
		}

		return `Updated ${agent.name} schedule to "${result.humanReadable}" (${result.cronExpression}).`;
	} catch (err) {
		return `Could not parse schedule: ${err instanceof Error ? err.message : err}. Try a different description.`;
	}
}

/**
 * Fallback for unrecognized intent.
 */
function handleUnknown(): string {
	return `I didn't understand that. Here's what I can do:\n\n${HELP_TEXT}`;
}

/**
 * Main message handler: dispatches Telegram messages to the appropriate command handler.
 * /start and /help bypass the LLM intent parser.
 */
export async function handleTelegramMessage(message: TelegramMessage, db: Database): Promise<void> {
	const text = message.text?.trim() ?? "";
	const chatId = String(message.chat.id);
	const botToken = env.TELEGRAM_BOT_TOKEN as string;

	// Slash commands bypass LLM
	if (text.toLowerCase() === "/start" || text.toLowerCase() === "/help") {
		await sendPlainText(botToken, chatId, handleHelp());
		return;
	}

	// Send typing indicator for LLM-processed messages
	await sendTypingAction(botToken, chatId).catch(() => {});

	// Get agent names for intent parsing
	const allAgents = db.select().from(agents).all();
	const agentNames = allAgents.map((a) => a.name);

	// Parse intent via LLM
	let intent: Awaited<ReturnType<typeof parseIntent>>;
	try {
		intent = await parseIntent(text, agentNames);
	} catch {
		await sendPlainText(
			botToken,
			chatId,
			"Something went wrong processing your message. Try again or type /help.",
		);
		return;
	}

	// Dispatch based on intent action
	let reply: string;
	try {
		switch (intent.action) {
			case "list":
				reply = handleList(db);
				break;
			case "run":
				reply = intent.agentName
					? handleRun(intent.agentName, db)
					: "Please specify which agent to run. Try: list agents";
				break;
			case "enable":
				reply = intent.agentName
					? handleEnable(intent.agentName, db)
					: "Please specify which agent to enable. Try: list agents";
				break;
			case "disable":
				reply = intent.agentName
					? handleDisable(intent.agentName, db)
					: "Please specify which agent to disable. Try: list agents";
				break;
			case "status":
				reply = handleStatus(db);
				break;
			case "reschedule":
				if (!intent.agentName || !intent.scheduleInput) {
					reply =
						"Please specify agent and schedule. Example: change Morning Briefing to every weekday at 9am";
				} else {
					reply = await handleReschedule(intent.agentName, intent.scheduleInput, db);
				}
				break;
			case "unknown":
				reply = handleUnknown();
				break;
			default:
				reply = handleUnknown();
				break;
		}
	} catch (err) {
		reply = `Something went wrong: ${err instanceof Error ? err.message : err}. Try /help.`;
	}

	await sendPlainText(botToken, chatId, reply);
}
