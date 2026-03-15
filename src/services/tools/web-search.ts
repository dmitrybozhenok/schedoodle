import { tool } from "ai";
import { z } from "zod";
import { env } from "../../config/env.js";

const webSearchParams = z.object({
	query: z.string().describe("The search query"),
	count: z
		.number()
		.int()
		.min(1)
		.max(10)
		.default(5)
		.optional()
		.describe("Number of results to return (1-10, default 5)"),
});

export const webSearchTool = tool({
	description:
		"Search the web using Brave Search. Returns titles, URLs, and descriptions of matching pages. Use when you need to find current information, news, or discover URLs to fetch.",
	inputSchema: webSearchParams,
	execute: async ({ query, count = 5 }: z.infer<typeof webSearchParams>, { abortSignal }) => {
		const apiKey = env.BRAVE_API_KEY;
		if (!apiKey) {
			return "[Web search unavailable: BRAVE_API_KEY not configured]";
		}
		try {
			const params = new URLSearchParams({ q: query, count: String(count) });
			const signals = [AbortSignal.timeout(10_000)];
			if (abortSignal) signals.push(abortSignal);
			const combinedSignal = AbortSignal.any(signals);
			const response = await fetch(
				`https://api.search.brave.com/res/v1/web/search?${params}`,
				{
					signal: combinedSignal,
					headers: {
						Accept: "application/json",
						"X-Subscription-Token": apiKey,
					},
				},
			);
			if (!response.ok) {
				return `[Search failed: HTTP ${response.status}]`;
			}
			const data = (await response.json()) as {
				web?: { results?: Array<{ title: string; url: string; description: string }> };
			};
			const results = data.web?.results ?? [];
			return results
				.map(
					(r: { title: string; url: string; description: string }) =>
						`${r.title}\n${r.url}\n${r.description}`,
				)
				.join("\n\n");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return `[Search failed: ${msg}]`;
		}
	},
});
