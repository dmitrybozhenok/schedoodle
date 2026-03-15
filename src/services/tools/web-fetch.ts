import { tool } from "ai";
import { convert } from "html-to-text";
import { z } from "zod";

export const webFetchTool = tool({
	description:
		"Fetch content from a URL. Returns plain text for HTML pages, raw text for JSON/other. Use when you need to read a webpage, API, or data source not already provided in the context.",
	parameters: z.object({
		url: z.string().url().describe("The HTTP or HTTPS URL to fetch"),
	}),
	execute: async ({ url }, { abortSignal }) => {
		try {
			const combinedSignal = AbortSignal.any([abortSignal, AbortSignal.timeout(10_000)]);
			const response = await fetch(url, {
				signal: combinedSignal,
				headers: { "User-Agent": "Schedoodle/1.0" },
			});
			const contentType = response.headers.get("content-type") ?? "";
			const body = await response.text();
			if (contentType.includes("text/html")) {
				return convert(body, { wordwrap: 120 });
			}
			return body;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return `[Failed to fetch ${url} -- ${msg}]`;
		}
	},
});
