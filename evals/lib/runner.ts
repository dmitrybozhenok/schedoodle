/**
 * Eval runner — orchestrates fixture loading, execution, scoring, and reporting.
 *
 * Three layers of evaluation:
 *   Layer 1: Deterministic checks (schema, keywords, length, regex)
 *   Layer 2: AI-as-judge scoring (relevance, factual consistency, instruction-following)
 *   Layer 3: Threshold regression detection (cost, latency, tokens)
 */

import { type JudgeProvider, scoreAllCriteria } from "../scorers/ai-judge.js";
import { evaluateCheck } from "./checks.js";
import type { EvalCase, EvalOutput, EvalResult, EvalRunSummary } from "./types.js";

const BASE_URL = process.env.SCHEDOODLE_URL ?? "http://localhost:3000";

// ── API Helpers ──────────────────────────────────────────────────

async function apiPost(path: string, body?: unknown) {
	const res = await fetch(`${BASE_URL}${path}`, {
		method: "POST",
		headers: body ? { "Content-Type": "application/json" } : {},
		body: body ? JSON.stringify(body) : undefined,
	});
	return res.json();
}

async function apiGet(path: string) {
	const res = await fetch(`${BASE_URL}${path}`);
	return res.json();
}

async function apiDelete(path: string) {
	await fetch(`${BASE_URL}${path}`, { method: "DELETE" });
}

async function apiPatch(path: string, body: unknown) {
	await fetch(`${BASE_URL}${path}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

// ── Case Execution ───────────────────────────────────────────────

async function executeCase(evalCase: EvalCase, agentId: number): Promise<EvalOutput> {
	const execResult = (await apiPost(`/agents/${agentId}/execute`)) as {
		status: string;
		executionId?: number;
		output?: { summary: string; details: string; data?: string };
		error?: string;
	};

	let durationMs = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let estimatedCost = 0;

	if (execResult.executionId) {
		const executions = (await apiGet(`/agents/${agentId}/executions?limit=1`)) as Array<{
			durationMs: number;
			inputTokens: number;
			outputTokens: number;
			estimatedCost: number;
		}>;
		if (executions.length > 0) {
			durationMs = executions[0].durationMs ?? 0;
			inputTokens = executions[0].inputTokens ?? 0;
			outputTokens = executions[0].outputTokens ?? 0;
			estimatedCost = executions[0].estimatedCost ?? 0;
		}
	}

	return {
		status: execResult.status,
		summary: execResult.output?.summary ?? "",
		details: execResult.output?.details ?? "",
		data: execResult.output?.data,
		durationMs,
		inputTokens,
		outputTokens,
		estimatedCost,
	};
}

// ── Single Case Evaluation ───────────────────────────────────────

export async function evaluateCase(
	evalCase: EvalCase,
	agentId: number,
	options: { enableJudge?: boolean; judgeModel?: string; judgeProvider?: JudgeProvider } = {},
): Promise<EvalResult> {
	try {
		const output = await executeCase(evalCase, agentId);

		// Layer 1: Deterministic checks
		const checkResults = evalCase.checks.map((check) => ({
			name: check.name,
			passed: evaluateCheck(check, output),
		}));

		// Layer 2: AI-as-judge (if enabled and criteria defined)
		let judgeScores: { criterion: string; score: number; reasoning: string }[] | undefined;
		if (options.enableJudge && evalCase.judgeCriteria && evalCase.judgeCriteria.length > 0) {
			judgeScores = await scoreAllCriteria(
				evalCase.judgeCriteria,
				{
					taskDescription: evalCase.agent.taskDescription,
					systemPrompt: evalCase.agent.systemPrompt,
					output: {
						summary: output.summary,
						details: output.details,
						data: output.data,
					},
					referenceOutput: evalCase.referenceOutput,
				},
				{ judgeModel: options.judgeModel, judgeProvider: options.judgeProvider },
			);
		}

		// Layer 3: Threshold checks
		const thresholdViolations: string[] = [];
		if (evalCase.thresholds) {
			const t = evalCase.thresholds;
			if (t.maxDurationMs && output.durationMs > t.maxDurationMs) {
				thresholdViolations.push(`Duration ${output.durationMs}ms > max ${t.maxDurationMs}ms`);
			}
			if (t.maxOutputTokens && output.outputTokens > t.maxOutputTokens) {
				thresholdViolations.push(`Output tokens ${output.outputTokens} > max ${t.maxOutputTokens}`);
			}
			if (t.maxCostUsd && output.estimatedCost > t.maxCostUsd) {
				thresholdViolations.push(`Cost $${output.estimatedCost} > max $${t.maxCostUsd}`);
			}
		}

		// Check if judge criteria pass their minimums
		const judgePass =
			!judgeScores ||
			judgeScores.every((js) => {
				const criterion = evalCase.judgeCriteria?.find((c) => c.name === js.criterion);
				return criterion ? js.score >= criterion.minScore : true;
			});

		const allChecksPassed = checkResults.every((c) => c.passed);
		const passed = allChecksPassed && judgePass && thresholdViolations.length === 0;

		return {
			caseId: evalCase.id,
			caseName: evalCase.name,
			model: evalCase.agent.model ?? "default",
			tags: evalCase.tags,
			output,
			checks: checkResults,
			judgeScores,
			passed,
			thresholdViolations: thresholdViolations.length > 0 ? thresholdViolations : undefined,
		};
	} catch (err) {
		return {
			caseId: evalCase.id,
			caseName: evalCase.name,
			model: evalCase.agent.model ?? "default",
			tags: evalCase.tags,
			output: {
				status: "error",
				summary: "",
				details: "",
				durationMs: 0,
				inputTokens: 0,
				outputTokens: 0,
				estimatedCost: 0,
			},
			checks: evalCase.checks.map((c) => ({
				name: c.name,
				passed: false,
			})),
			passed: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

// ── Full Eval Run ────────────────────────────────────────────────

export async function runEvalSuite(
	cases: EvalCase[],
	options: {
		model?: string;
		enableJudge?: boolean;
		judgeModel?: string;
		judgeProvider?: JudgeProvider;
	} = {},
): Promise<EvalRunSummary> {
	const runId = `eval-${Date.now()}`;
	const model = options.model ?? "default";

	// Verify server is up
	try {
		const health = (await apiGet("/health")) as { status: string };
		if (health.status !== "ok") throw new Error("unhealthy");
	} catch {
		throw new Error(`Schedoodle server not running on ${BASE_URL}`);
	}

	// Create eval agents (cleanup any leftover agents with matching names first)
	const existingAgents = (await apiGet("/agents")) as Array<{ id: number; name: string }>;
	for (const evalCase of cases) {
		const old = existingAgents.filter((a) => a.name === evalCase.agent.name);
		for (const o of old) await apiDelete(`/agents/${o.id}`);
	}

	const agentIds = new Map<string, number>();
	for (const evalCase of cases) {
		const created = (await apiPost("/agents", evalCase.agent)) as {
			id: number;
			error?: string;
		};
		if (!created.id) {
			// Retry once after a brief pause
			await new Promise((r) => setTimeout(r, 500));
			const retry = (await apiPost("/agents", evalCase.agent)) as { id: number };
			agentIds.set(evalCase.id, retry.id);
		} else {
			agentIds.set(evalCase.id, created.id);
		}

		// Set model if specified
		if (options.model) {
			await apiPatch(`/agents/${created.id}`, { model: options.model });
		}
	}

	// Run all cases
	const results: EvalResult[] = [];
	for (const evalCase of cases) {
		const agentId = agentIds.get(evalCase.id)!;
		const result = await evaluateCase(evalCase, agentId, {
			enableJudge: options.enableJudge,
			judgeModel: options.judgeModel,
			judgeProvider: options.judgeProvider,
		});
		result.model = model;
		results.push(result);
	}

	// Cleanup eval agents
	for (const [, id] of agentIds) {
		await apiDelete(`/agents/${id}`);
	}

	// Compute slices
	const slices: EvalRunSummary["slices"] = {};
	const allTags = new Set(cases.flatMap((c) => c.tags));
	for (const tag of allTags) {
		const tagResults = results.filter((r) => r.tags.includes(tag));
		const passed = tagResults.filter((r) => r.passed).length;
		slices[tag] = {
			total: tagResults.length,
			passed,
			rate: tagResults.length > 0 ? passed / tagResults.length : 0,
		};
	}

	// Compute aggregate metrics
	const durations = results.map((r) => r.output.durationMs).sort((a, b) => a - b);
	const p95Index = Math.min(Math.ceil(durations.length * 0.95) - 1, durations.length - 1);

	const judgeScoresAll = results
		.flatMap((r) => r.judgeScores ?? [])
		.map((js) => js.score)
		.filter((s) => s > 0);

	const passedCases = results.filter((r) => r.passed).length;

	return {
		runId,
		timestamp: new Date().toISOString(),
		model,
		totalCases: cases.length,
		passedCases,
		failedCases: cases.length - passedCases,
		slices,
		metrics: {
			avgDurationMs:
				durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
			p95DurationMs: durations[p95Index] ?? 0,
			avgOutputTokens:
				results.length > 0
					? results.reduce((a, r) => a + r.output.outputTokens, 0) / results.length
					: 0,
			totalCostUsd: results.reduce((a, r) => a + r.output.estimatedCost, 0),
			schemaPassRate:
				results.length > 0
					? results.filter((r) => r.checks.find((c) => c.name === "Returns success")?.passed)
							.length / results.length
					: 0,
			avgJudgeScore:
				judgeScoresAll.length > 0
					? judgeScoresAll.reduce((a, b) => a + b, 0) / judgeScoresAll.length
					: undefined,
		},
		results,
	};
}
