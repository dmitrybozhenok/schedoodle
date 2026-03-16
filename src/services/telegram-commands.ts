import { eq, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import type { Database } from "../db/index.js";
import { agents } from "../db/schema.js";
import { enrichAgent, getConsecutiveFailures } from "../helpers/enrich-agent.js";
import { log } from "../helpers/logger.js";
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
- "create [name] that [does task] every [schedule]" - create a new agent
- "delete [agent name]" - delete an agent (with confirmation)
- "update [agent name] task to [description]" - change task
- "rename [agent name] to [new name]" - rename an agent

Commands: /help, /start`;

interface PendingDeletion {
	agentId: number;
	agentName: string;
	expiresAt: number;
	timer: ReturnType<typeof setTimeout>;
}

const pendingDeletions = new Map<string, PendingDeletion>();

function setPendingDeletion(chatId: string, agentId: number, agentName: string): void {
	clearPendingDeletion(chatId);
	const timer = setTimeout(() => pendingDeletions.delete(chatId), 60_000);
	timer.unref(); // Prevent timer from keeping process alive during shutdown
	pendingDeletions.set(chatId, {
		agentId,
		agentName,
		expiresAt: Date.now() + 60_000,
		timer,
	});
}

function clearPendingDeletion(chatId: string): void {
	const existing = pendingDeletions.get(chatId);
	if (existing) {
		clearTimeout(existing.timer);
		pendingDeletions.delete(chatId);
	}
}

/** @internal Test-only: clear all pending deletions for test isolation */
export function _resetPendingDeletions(): void {
	for (const [chatId] of pendingDeletions) {
		clearPendingDeletion(chatId);
	}
}

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
		log.telegram.error(`Run "${agent.name}" failed: ${err instanceof Error ? err.message : err}`),
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
 * Create a new agent with optional schedule.
 */
async function handleCreate(
	agentName: string | null,
	taskDescription: string | null,
	scheduleInput: string | null,
	db: Database,
): Promise<string> {
	if (!agentName || !taskDescription) {
		return 'Missing name or task. Example: "create Morning Briefing that summarizes my emails every day at 7am"';
	}

	// Check duplicate name
	const existing = findAgentByName(agentName, db);
	if (existing) {
		return `Agent "${agentName}" already exists. Use "update ${agentName} task to ..." to modify it.`;
	}

	let cronSchedule = "";
	let humanReadable: string | null = null;
	if (scheduleInput) {
		try {
			const result = await parseSchedule(scheduleInput);
			cronSchedule = result.cronExpression;
			humanReadable = result.humanReadable;
		} catch {
			return `Could not parse schedule "${scheduleInput}". Try a different description, or create without a schedule.`;
		}
	}

	const now = new Date().toISOString();
	const enabled = cronSchedule ? 1 : 0;

	try {
		const created = db
			.insert(agents)
			.values({
				name: agentName,
				taskDescription,
				cronSchedule,
				enabled,
				createdAt: now,
				updatedAt: now,
			})
			.returning()
			.get();

		if (enabled === 1 && cronSchedule) {
			scheduleAgent(created, db);
		}

		const lines = [`Created "${created.name}".`];
		lines.push(`Task: ${taskDescription}`);
		if (humanReadable) {
			lines.push(`Schedule: ${humanReadable} (${cronSchedule})`);
			lines.push("Status: enabled");
		} else {
			lines.push("Schedule: none (disabled)");
			lines.push("Status: disabled -- set a schedule to enable");
		}
		return lines.join("\n");
	} catch (err) {
		if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
			return `Agent "${agentName}" already exists. Use "update ${agentName} task to ..." to modify it.`;
		}
		throw err;
	}
}

/**
 * Initiate a deletion confirmation flow for an agent.
 */
function handleDeleteRequest(agentName: string, chatId: string, db: Database): string {
	const agent = findAgentByName(agentName, db);
	if (!agent) return `Agent "${agentName}" not found. Try: list agents`;

	setPendingDeletion(chatId, agent.id, agent.name);
	return `Delete "${agent.name}"? This removes the agent and disconnects its execution history. Reply "yes" to confirm or "no" to cancel. (Expires in 60s)`;
}

/**
 * Execute a confirmed deletion.
 */
function handleConfirmDelete(pending: PendingDeletion, db: Database): string {
	const agent = db.select().from(agents).where(eq(agents.id, pending.agentId)).get();
	if (!agent) {
		return `Agent "${pending.agentName}" no longer exists.`;
	}

	removeAgent(agent.id);
	db.delete(agents).where(eq(agents.id, agent.id)).run();

	return `Deleted "${agent.name}" and removed its scheduled job.`;
}

/**
 * Update an agent's task description.
 */
function handleUpdateTask(agentName: string, taskDescription: string, db: Database): string {
	const agent = findAgentByName(agentName, db);
	if (!agent) return `Agent "${agentName}" not found. Try: list agents`;

	db.update(agents)
		.set({ taskDescription, updatedAt: new Date().toISOString() })
		.where(eq(agents.id, agent.id))
		.run();

	return `Updated ${agent.name} task.`;
}

/**
 * Rename an agent.
 */
function handleRename(agentName: string, newName: string, db: Database): string {
	const agent = findAgentByName(agentName, db);
	if (!agent) return `Agent "${agentName}" not found. Try: list agents`;

	const conflict = findAgentByName(newName, db);
	if (conflict) return `Name "${newName}" is already taken. Choose a different name.`;

	try {
		db.update(agents)
			.set({ name: newName, updatedAt: new Date().toISOString() })
			.where(eq(agents.id, agent.id))
			.run();
		return `Renamed "${agent.name}" to "${newName}".`;
	} catch (err) {
		if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
			return `Name "${newName}" is already taken. Choose a different name.`;
		}
		throw err;
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

	// Check pending deletion BEFORE LLM parsing
	const pending = pendingDeletions.get(chatId);
	if (pending && pending.expiresAt > Date.now()) {
		const lower = text.toLowerCase();
		if (lower === "yes" || lower === "confirm") {
			clearPendingDeletion(chatId);
			const reply = handleConfirmDelete(pending, db);
			await sendPlainText(botToken, chatId, reply);
			return;
		}
		if (lower === "no" || lower === "cancel") {
			clearPendingDeletion(chatId);
			await sendPlainText(botToken, chatId, "Deletion cancelled.");
			return;
		}
		// Any other message: clear pending and fall through to normal processing
		clearPendingDeletion(chatId);
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
			case "create":
				reply = await handleCreate(
					intent.agentName,
					intent.taskDescription,
					intent.scheduleInput,
					db,
				);
				break;
			case "delete":
				reply = intent.agentName
					? handleDeleteRequest(intent.agentName, chatId, db)
					: "Please specify which agent to delete. Try: list agents";
				break;
			case "update_task":
				if (!intent.agentName || !intent.taskDescription) {
					reply =
						'Please specify agent and new task. Example: "update Morning Briefing task to check weather"';
				} else {
					reply = handleUpdateTask(intent.agentName, intent.taskDescription, db);
				}
				break;
			case "rename":
				if (!intent.agentName || !intent.newName) {
					reply =
						'Please specify current and new name. Example: "rename Morning Briefing to Daily Digest"';
				} else {
					reply = handleRename(intent.agentName, intent.newName, db);
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
