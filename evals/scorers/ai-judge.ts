/**
 * AI-as-Judge scorer (Layer 2).
 *
 * Uses a second LLM call to evaluate output quality against rubric criteria.
 * Based on the G-Eval methodology (Liu et al., EMNLP 2023):
 *   1. Task description → what the agent was supposed to do
 *   2. Criteria rubric → specific dimension to evaluate
 *   3. Chain-of-thought → judge reasons before scoring
 *   4. Score → numeric result
 *
 * Key practices (from Chip Huyen, AI Engineering Ch. 4):
 *   - Use coarse scales (binary or 1-5, not 1-10)
 *   - Always request reasoning before the score
 *   - Use a stronger model as judge when possible
 *   - Set temperature to 0 for reproducibility
 *
 * Supports Gemini (default) and Anthropic as judge providers.
 */
import type { JudgeCriterion } from "../lib/types.js";

export interface JudgeInput {
	taskDescription: string;
	systemPrompt?: string;
	output: { summary: string; details: string; data?: string };
	referenceOutput?: string;
}

export interface JudgeScore {
	criterion: string;
	score: number;
	reasoning: string;
}

export type JudgeProvider = "gemini" | "anthropic";

function buildBinaryPrompt(criterion: JudgeCriterion, input: JudgeInput): string {
	return `You are evaluating the quality of an AI agent's output.

## Task Given to the Agent
${input.systemPrompt ? `System Prompt: ${input.systemPrompt}\n` : ""}Task: ${input.taskDescription}

## Agent Output
Summary: ${input.output.summary}
Details: ${input.output.details}${input.output.data ? `\nData: ${input.output.data}` : ""}
${input.referenceOutput ? `\n## Reference Output (for comparison)\n${input.referenceOutput}\n` : ""}
## Evaluation Criterion: ${criterion.name}
${criterion.rubric}

## Instructions
1. First, reason step-by-step about whether the output meets the criterion.
2. Then give a score of 0 (fail) or 1 (pass).

Respond in this exact format:
REASONING: <your step-by-step reasoning>
SCORE: <0 or 1>`;
}

function buildLikertPrompt(criterion: JudgeCriterion, input: JudgeInput): string {
	return `You are evaluating the quality of an AI agent's output.

## Task Given to the Agent
${input.systemPrompt ? `System Prompt: ${input.systemPrompt}\n` : ""}Task: ${input.taskDescription}

## Agent Output
Summary: ${input.output.summary}
Details: ${input.output.details}${input.output.data ? `\nData: ${input.output.data}` : ""}
${input.referenceOutput ? `\n## Reference Output (for comparison)\n${input.referenceOutput}\n` : ""}
## Evaluation Criterion: ${criterion.name}
${criterion.rubric}

## Scoring Rubric
5: Excellent — fully meets the criterion with high quality
4: Good — mostly meets the criterion with minor gaps
3: Adequate — partially meets the criterion; some issues
2: Poor — minimally relevant; significant gaps
1: Failing — does not meet the criterion at all

## Instructions
1. First, reason step-by-step about how well the output meets the criterion.
2. Then give a score from 1 to 5.
Note: Length is NOT an indicator of quality. A concise, accurate response can score 5.

Respond in this exact format:
REASONING: <your step-by-step reasoning>
SCORE: <1-5>`;
}

function parseJudgeResponse(response: string): {
	reasoning: string;
	score: number;
} {
	const reasoningMatch = response.match(/REASONING:\s*([\s\S]*?)(?=\nSCORE:)/i);
	const scoreMatch = response.match(/SCORE:\s*(\d+)/i);

	return {
		reasoning: reasoningMatch?.[1]?.trim() ?? response,
		score: scoreMatch ? Number.parseInt(scoreMatch[1], 10) : 0,
	};
}

// ── Provider-specific API calls ──────────────────────────────────

async function callGemini(
	prompt: string,
	apiKey: string,
	model: string,
): Promise<string> {
	const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

	const response = await fetch(apiUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			contents: [{ parts: [{ text: prompt }] }],
			generationConfig: {
				temperature: 0,
				maxOutputTokens: 1024,
			},
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Gemini ${response.status}: ${body.slice(0, 200)}`);
	}

	const data = (await response.json()) as {
		candidates: Array<{
			content: { parts: Array<{ text: string }> };
		}>;
	};

	return data.candidates?.[0]?.content?.parts
		?.map((p) => p.text)
		.join("") ?? "";
}

async function callAnthropic(
	prompt: string,
	apiKey: string,
	model: string,
): Promise<string> {
	const response = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model,
			max_tokens: 1024,
			temperature: 0,
			messages: [{ role: "user", content: prompt }],
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Anthropic ${response.status}: ${body.slice(0, 200)}`);
	}

	const data = (await response.json()) as {
		content: Array<{ type: string; text: string }>;
	};

	return data.content
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("");
}

// ── Defaults per provider ────────────────────────────────────────

const PROVIDER_DEFAULTS: Record<JudgeProvider, { envKey: string; model: string }> = {
	gemini: { envKey: "GEMINI_API_KEY", model: "gemini-3.1-flash-lite-preview" },
	anthropic: { envKey: "ANTHROPIC_API_KEY", model: "claude-sonnet-4-20250514" },
};

function resolveProvider(): JudgeProvider {
	// Prefer Gemini if key is available, fall back to Anthropic
	if (process.env.GEMINI_API_KEY) return "gemini";
	if (process.env.ANTHROPIC_API_KEY) return "anthropic";
	return "gemini"; // default, will show SKIPPED if no key
}

// ── Public API ───────────────────────────────────────────────────

export async function scoreWithJudge(
	criterion: JudgeCriterion,
	input: JudgeInput,
	options: {
		judgeProvider?: JudgeProvider;
		judgeApiKey?: string;
		judgeModel?: string;
	} = {},
): Promise<JudgeScore> {
	const prompt =
		criterion.scale === "binary"
			? buildBinaryPrompt(criterion, input)
			: buildLikertPrompt(criterion, input);

	const provider = options.judgeProvider ?? resolveProvider();
	const defaults = PROVIDER_DEFAULTS[provider];
	const apiKey = options.judgeApiKey ?? process.env[defaults.envKey];
	const model = options.judgeModel ?? defaults.model;

	if (!apiKey) {
		return {
			criterion: criterion.name,
			score: 0,
			reasoning: `SKIPPED: No ${defaults.envKey} available for AI judge`,
		};
	}

	try {
		const text =
			provider === "gemini"
				? await callGemini(prompt, apiKey, model)
				: await callAnthropic(prompt, apiKey, model);

		const parsed = parseJudgeResponse(text);
		return {
			criterion: criterion.name,
			score: parsed.score,
			reasoning: parsed.reasoning,
		};
	} catch (err) {
		return {
			criterion: criterion.name,
			score: 0,
			reasoning: `JUDGE ERROR: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

/**
 * Score an output against multiple criteria.
 */
export async function scoreAllCriteria(
	criteria: JudgeCriterion[],
	input: JudgeInput,
	options?: Parameters<typeof scoreWithJudge>[2],
): Promise<JudgeScore[]> {
	// Run criteria sequentially to avoid rate limiting
	const scores: JudgeScore[] = [];
	for (const criterion of criteria) {
		const score = await scoreWithJudge(criterion, input, options);
		scores.push(score);
	}
	return scores;
}
