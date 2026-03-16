import { generateText, NoObjectGeneratedError, Output } from "ai";
import { DEFAULT_MODEL, resolveModel } from "../config/llm-provider.js";
import { type TelegramIntent, telegramIntentSchema } from "../schemas/telegram-intent.js";

/**
 * Parse a user's Telegram message into a structured intent using LLM.
 * Resolves fuzzy agent names against the provided agent list.
 */
export async function parseIntent(
	userMessage: string,
	agentNames: string[],
): Promise<TelegramIntent> {
	const agentList =
		agentNames.length > 0
			? agentNames.map((n, i) => `${i + 1}. ${n}`).join("\n")
			: "(no agents configured)";

	const systemPrompt = `You are a command parser for a bot that controls scheduled agents.

Available agents:
${agentList}

Parse the user's message and extract their intent.

Actions:
- "list" — user wants to see all agents. Set agentName to null.
- "run" — user wants to execute an agent. Set agentName to the EXACT name from the list.
- "enable" — user wants to enable an agent. Set agentName to the EXACT name from the list.
- "disable" — user wants to disable an agent. Set agentName to the EXACT name from the list.
- "status" — user wants system health info. Set agentName to null.
- "reschedule" — user wants to change an existing agent's schedule. Set agentName to the EXACT name from the list. Set scheduleInput to the schedule description (e.g., "every weekday at 9am").
- "create" — user wants to create a new agent. Set agentName to the new agent's name. Set taskDescription to what the agent should do. Set scheduleInput to the schedule description if provided, or null if no schedule mentioned.
- "delete" — user wants to delete an agent. Set agentName to the EXACT name from the list.
- "update_task" — user wants to change what an agent does (its task description). Set agentName to the EXACT name from the list. Set taskDescription to the new task description.
- "rename" — user wants to change an agent's name. Set agentName to the EXACT current name from the list. Set newName to the desired new name.
- "unknown" — cannot determine intent.

Disambiguation rules:
- "change/update X schedule to Y" or "change X to every..." → reschedule (schedule change)
- "update X task to Y" or "change what X does to Y" → update_task (task description change)
- "rename X to Y" or "call X as Y" → rename (name change)
- "create X that does Y every Z" → create (new agent)
- "delete X" or "remove X" → delete

Rules:
- Match agent names fuzzily: "briefing" should match "Morning Briefing Agent", "PR" should match "PR Reminder"
- For "create", agentName is the NEW name (not from the list). taskDescription is required. scheduleInput is optional.
- For "run", "enable", "disable", "reschedule", "delete", "update_task", "rename", set agentName to the EXACT name from the agent list above
- Set taskDescription to null unless action is "create" or "update_task"
- Set newName to null unless action is "rename"
- Set scheduleInput to null unless action is "reschedule" or "create" (with schedule)
- If you cannot determine the intent, use action "unknown"
- If the user mentions an agent that doesn't exist in the list (except for "create"), use action "unknown"`;

	const model = await resolveModel(DEFAULT_MODEL);
	const prompt = `User message: "${userMessage}"`;

	try {
		const result = await generateText({
			model,
			output: Output.object({ schema: telegramIntentSchema }),
			prompt,
			system: systemPrompt,
		});
		return result.output as TelegramIntent;
	} catch (error) {
		if (NoObjectGeneratedError.isInstance(error)) {
			// Retry once with error feedback appended
			const errorMsg = error instanceof Error ? error.message : String(error);
			const retryPrompt = `User message: "${userMessage}"\n\n[Previous attempt failed: ${errorMsg}]\nPlease provide a valid response matching the required schema.`;
			const retryResult = await generateText({
				model,
				output: Output.object({ schema: telegramIntentSchema }),
				prompt: retryPrompt,
				system: systemPrompt,
			});
			return retryResult.output as TelegramIntent;
		}
		throw error;
	}
}
