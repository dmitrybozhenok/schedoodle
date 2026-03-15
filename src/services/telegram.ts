/**
 * Telegram Bot API utilities for MarkdownV2 escaping and message sending.
 */

/**
 * Escape all 18 MarkdownV2 special characters for text outside formatting entities.
 * Characters: _ * [ ] ( ) ~ ` > # + - = | { } . ! \
 */
export function escapeMdV2(text: string): string {
	return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Escape only backtick and backslash for text inside pre/code blocks.
 */
export function escapeMdV2CodeBlock(text: string): string {
	return text.replace(/([`\\])/g, "\\$1");
}

/**
 * Send a message via Telegram Bot API.
 * Uses MarkdownV2 parse mode and disables link previews.
 */
export async function sendTelegramMessage(
	botToken: string,
	chatId: string,
	text: string,
): Promise<{ ok: boolean; description?: string }> {
	const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: chatId,
			text,
			parse_mode: "MarkdownV2",
			link_preview_options: { is_disabled: true },
		}),
	});

	const data = (await response.json()) as { ok: boolean; description?: string };
	return data;
}
