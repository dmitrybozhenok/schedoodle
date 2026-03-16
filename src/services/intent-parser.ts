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

Rules:
- Match agent names fuzzily: "briefing" should match "Morning Briefing Agent", "PR" should match "PR Reminder"
- For "list" and "status" actions, set agentName to null
- For "reschedule", extract the schedule description into scheduleInput (e.g., "change briefing to 8am" -> scheduleInput: "8am")
- For "run", "enable", "disable", set agentName to the EXACT name from the agent list above
- If you cannot determine the intent, use action "unknown"
- If the user mentions an agent that doesn't exist in the list, use action "unknown"`;

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
