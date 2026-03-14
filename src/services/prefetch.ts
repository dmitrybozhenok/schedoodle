import { convert } from "html-to-text";

const URL_REGEX = /https?:\/\/[^\s)>\]]+/g;

/**
 * Extract HTTP/HTTPS URLs from text, deduplicated.
 */
export function extractUrls(text: string): string[] {
	const matches = text.match(URL_REGEX);
	if (!matches) return [];
	return [...new Set(matches)];
}

/**
 * Pre-fetch URLs found in a task description.
 * Returns a map of URL -> content (or failure note).
 * HTML is converted to plain text; JSON is passed through raw.
 * Each fetch has a 10-second timeout. Failures are captured, not thrown.
 */
export async function prefetchUrls(
	taskDescription: string,
): Promise<Map<string, string>> {
	const urls = extractUrls(taskDescription);
	const results = new Map<string, string>();

	if (urls.length === 0) return results;

	const settled = await Promise.allSettled(
		urls.map(async (url) => {
			const response = await fetch(url, {
				signal: AbortSignal.timeout(10_000),
			});
			const contentType = response.headers.get("content-type") ?? "";
			const body = await response.text();

			if (contentType.includes("text/html")) {
				return { url, content: convert(body, { wordwrap: 120 }) };
			}
			return { url, content: body };
		}),
	);

	for (const result of settled) {
		if (result.status === "fulfilled") {
			results.set(result.value.url, result.value.content);
		} else {
			// Extract URL from the rejected promise - match against our urls list
			const reason =
				result.reason instanceof Error
					? result.reason.message
					: String(result.reason);
			// We need to find which URL this corresponds to
			// Since Promise.allSettled preserves order, use index
			const index = settled.indexOf(result);
			const url = urls[index];
			results.set(url, `[Failed to fetch ${url} -- ${reason}]`);
		}
	}

	return results;
}

/**
 * Build a prompt by appending pre-fetched context data to the task description.
 * If contextData is empty, returns the task description unchanged.
 */
export function buildPrompt(
	taskDescription: string,
	contextData: Map<string, string>,
): string {
	if (contextData.size === 0) return taskDescription;

	const sections: string[] = [];
	for (const [url, content] of contextData) {
		sections.push(
			`--- Content from ${url} ---\n${content}\n--- End ---`,
		);
	}

	return `${taskDescription}\n\nPre-fetched reference data:\n\n${sections.join("\n\n")}`;
}
