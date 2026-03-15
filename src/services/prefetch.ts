import { isIP } from "node:net";
import { convert } from "html-to-text";

const URL_REGEX = /https?:\/\/[^\s)>\]]+/g;

/** Maximum response body size in bytes (1 MB). */
const MAX_RESPONSE_BYTES = 1_048_576;

/**
 * Check whether a URL points to a private/internal network address.
 * Returns true (block) for: private IPs, localhost, IPv6 loopback,
 * non-HTTP protocols, and malformed URLs.
 */
export function isPrivateUrl(urlString: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(urlString);
	} catch {
		return true; // Malformed URL -- block
	}

	// Block non-HTTP/HTTPS protocols
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return true;
	}

	const hostname = parsed.hostname;

	// Block localhost
	if (hostname === "localhost") {
		return true;
	}

	// Block IPv6 loopback (URL parser strips brackets from hostname)
	if (hostname === "::1" || hostname === "[::1]") {
		return true;
	}

	// Check IPv4 private ranges
	if (isIP(hostname) === 4) {
		const octets = hostname.split(".").map(Number);
		// 127.0.0.0/8 (loopback)
		if (octets[0] === 127) return true;
		// 10.0.0.0/8 (private)
		if (octets[0] === 10) return true;
		// 172.16.0.0/12 (private)
		if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
		// 192.168.0.0/16 (private)
		if (octets[0] === 192 && octets[1] === 168) return true;
		// 169.254.0.0/16 (link-local)
		if (octets[0] === 169 && octets[1] === 254) return true;
		// 0.0.0.0/8
		if (octets[0] === 0) return true;
	}

	return false;
}

/**
 * Fetch a URL with a 1 MB response body size limit.
 * Returns the response body text, or a truncation message if the body exceeds the limit.
 */
async function fetchWithSizeLimit(url: string): Promise<{ content: string; contentType: string }> {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(10_000),
	});

	const contentType = response.headers.get("content-type") ?? "";

	// Fast path: check Content-Length header
	const contentLength = response.headers.get("content-length");
	if (contentLength && Number.parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
		return { content: `[Content truncated at 1MB -- ${url}]`, contentType };
	}

	// Streaming path: read body with size limit
	const reader = response.body?.getReader();
	if (!reader) {
		// Fallback if body is null (already protected by Content-Length check above)
		const text = await response.text();
		return { content: text, contentType };
	}

	const chunks: Uint8Array[] = [];
	let totalBytes = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		totalBytes += value.byteLength;
		if (totalBytes > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			return { content: `[Content truncated at 1MB -- ${url}]`, contentType };
		}
		chunks.push(value);
	}

	const decoder = new TextDecoder();
	const body =
		chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode();

	return { content: body, contentType };
}

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
 * Private/internal URLs are blocked (SSRF protection).
 * Response bodies exceeding 1 MB are truncated.
 */
export async function prefetchUrls(taskDescription: string): Promise<Map<string, string>> {
	const urls = extractUrls(taskDescription);
	const results = new Map<string, string>();

	if (urls.length === 0) return results;

	const settled = await Promise.allSettled(
		urls.map(async (url) => {
			// SSRF protection: block private/internal URLs
			if (isPrivateUrl(url)) {
				return { url, content: `[SSRF blocked -- ${url}]` };
			}

			const { content, contentType } = await fetchWithSizeLimit(url);

			// Apply HTML-to-text conversion if applicable (and not truncated)
			if (contentType.includes("text/html") && !content.startsWith("[Content truncated")) {
				return { url, content: convert(content, { wordwrap: 120 }) };
			}
			return { url, content };
		}),
	);

	for (const result of settled) {
		if (result.status === "fulfilled") {
			results.set(result.value.url, result.value.content);
		} else {
			// Extract URL from the rejected promise - match against our urls list
			const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
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
export function buildPrompt(taskDescription: string, contextData: Map<string, string>): string {
	if (contextData.size === 0) return taskDescription;

	const sections: string[] = [];
	for (const [url, content] of contextData) {
		sections.push(`--- Content from ${url} ---\n${content}\n--- End ---`);
	}

	return `${taskDescription}\n\nPre-fetched reference data:\n\n${sections.join("\n\n")}`;
}
