/**
 * Telegram Bot API polling loop for receiving incoming messages.
 * Uses getUpdates with long-polling and offset tracking.
 */

export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
}

export interface TelegramMessage {
	message_id: number;
	from?: { id: number; first_name: string };
	chat: { id: number; type: string };
	text?: string;
	date: number;
}

interface TelegramGetUpdatesResponse {
	ok: boolean;
	result: TelegramUpdate[];
	description?: string;
}

let running = false;

/**
 * Start long-polling the Telegram Bot API for incoming messages.
 * Only processes messages from the authorized chat ID; unauthorized messages
 * are silently ignored (no response, no log).
 */
export function startPolling(
	botToken: string,
	chatId: string,
	onMessage: (msg: TelegramMessage) => Promise<void>,
): void {
	running = true;
	let offset = 0;

	const poll = async () => {
		while (running) {
			try {
				const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
				const res = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ offset, timeout: 30, allowed_updates: ["message"] }),
				});
				const data = (await res.json()) as TelegramGetUpdatesResponse;

				if (data.ok && data.result.length > 0) {
					for (const update of data.result) {
						offset = update.update_id + 1;
						if (update.message?.text) {
							if (String(update.message.chat.id) !== chatId) {
								continue;
							}
							await onMessage(update.message);
						}
					}
				}
			} catch (err) {
				console.error(`[telegram-bot] Polling error: ${err instanceof Error ? err.message : err}`);
				if (running) {
					await new Promise((r) => setTimeout(r, 5000));
				}
			}
		}
	};

	void poll();
}

/**
 * Stop the polling loop gracefully.
 */
export function stopPolling(): void {
	running = false;
}

/**
 * Check whether the polling loop is currently active.
 */
export function isPollingActive(): boolean {
	return running;
}

/**
 * Send a plain text message via Telegram Bot API (no parse_mode).
 * Used for control responses where MarkdownV2 escaping is unnecessary.
 */
export async function sendPlainText(
	botToken: string,
	chatId: string | number,
	text: string,
): Promise<void> {
	const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
	await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: String(chatId), text }),
	});
}

/**
 * Send a typing indicator to show the bot is processing.
 */
export async function sendTypingAction(botToken: string, chatId: string | number): Promise<void> {
	const url = `https://api.telegram.org/bot${botToken}/sendChatAction`;
	await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: String(chatId), action: "typing" }),
	});
}
