import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "../../config/env.js";
import { escapeMdV2, sendTelegramMessage } from "../../services/telegram.js";
import { errorResponse, jsonResponse } from "../helpers.js";

/**
 * Register Telegram-related MCP tools on the server.
 * Tools: test_telegram
 */
export function registerTelegramTools(server: McpServer): void {
	server.registerTool(
		"test_telegram",
		{
			title: "Test Telegram",
			description: "Send a test message to verify Telegram bot configuration is working.",
			inputSchema: z.object({}),
		},
		async () => {
			const botToken = env.TELEGRAM_BOT_TOKEN;
			const chatId = env.TELEGRAM_CHAT_ID;

			if (!botToken || !chatId) {
				return errorResponse(
					"Telegram not configured",
					"Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables. Get a bot token from @BotFather on Telegram.",
				);
			}

			try {
				const result = await sendTelegramMessage(
					botToken,
					chatId,
					escapeMdV2("Hello from Schedoodle! Telegram notifications are working."),
				);

				if (!result.ok) {
					return errorResponse(
						`Telegram API error: ${result.description}`,
						"Check your TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID values. Ensure the bot has been started by sending /start in the chat.",
					);
				}

				return jsonResponse({ status: "sent", message: "Test message delivered successfully." });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return errorResponse(
					`Telegram send failed: ${message}`,
					"Check network connectivity and bot token validity.",
				);
			}
		},
	);
}
