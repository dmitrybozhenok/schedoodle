/**
 * Schedoodle Model Eval Harness
 *
 * Tests multiple agent scenarios against any Ollama model and scores outputs.
 * Usage: npx tsx evals/run-evals.ts [model1] [model2] ...
 * Example: npx tsx evals/run-evals.ts gemma3:12b gemma3:4b qwen2.5:7b qwen2.5:3b
 *
 * Requires: Schedoodle server running on localhost:3000 with LLM_PROVIDER=ollama
 */

const BASE_URL = process.env.SCHEDOODLE_URL ?? "http://localhost:3000";

// ── Test Case Definitions ──────────────────────────────────────────

interface TestCase {
	name: string;
	agent: {
		name: string;
		taskDescription: string;
		cronSchedule: string;
		systemPrompt?: string;
	};
	checks: Check[];
}

interface Check {
	name: string;
	field: "summary" | "details" | "status" | "meta";
	fn: (output: EvalOutput) => boolean;
}

interface EvalOutput {
	status: string;
	summary: string;
	details: string;
	data?: string;
	durationMs: number;
	inputTokens: number;
	outputTokens: number;
}

const TEST_CASES: TestCase[] = [
	{
		name: "Simple Summarisation",
		agent: {
			name: "__eval_summarise",
			taskDescription:
				"Summarise the key benefits of test-driven development in software engineering.",
			cronSchedule: "0 0 * * *",
		},
		checks: [
			{
				name: "Returns success",
				field: "status",
				fn: (o) => o.status === "success",
			},
			{
				name: "Summary is non-empty (>20 chars)",
				field: "summary",
				fn: (o) => o.summary.length > 20,
			},
			{
				name: "Details is non-empty (>20 chars)",
				field: "details",
				fn: (o) => o.details.length > 20,
			},
			{
				name: "Mentions TDD or test-driven",
				field: "summary",
				fn: (o) =>
					/tdd|test.driven/i.test(o.summary) ||
					/tdd|test.driven/i.test(o.details),
			},
			{
				name: "Mentions at least 2 benefits",
				field: "details",
				fn: (o) => {
					const text = `${o.summary} ${o.details}`.toLowerCase();
					const keywords = [
						"bug",
						"quality",
						"design",
						"refactor",
						"confidence",
						"documentation",
						"maintain",
						"modular",
						"reliable",
						"early",
					];
					return keywords.filter((k) => text.includes(k)).length >= 2;
				},
			},
		],
	},
	{
		name: "System Prompt Compliance",
		agent: {
			name: "__eval_pirate",
			taskDescription: "Explain how HTTP status codes work (200, 404, 500).",
			cronSchedule: "0 0 * * *",
			systemPrompt:
				"You are a grizzled pirate captain. Explain everything using nautical metaphors and pirate slang. Say arr frequently.",
		},
		checks: [
			{
				name: "Returns success",
				field: "status",
				fn: (o) => o.status === "success",
			},
			{
				name: "Contains pirate language (arr/aye/matey/hearty)",
				field: "summary",
				fn: (o) => {
					const text = `${o.summary} ${o.details}`.toLowerCase();
					return /\barr\b|aye|matey|heart/.test(text);
				},
			},
			{
				name: "Contains nautical terms (sail/sea/ship/voyage/captain/crew)",
				field: "details",
				fn: (o) => {
					const text = `${o.summary} ${o.details}`.toLowerCase();
					return /sail|sea|ship|voyage|captain|crew|island|anchor|storm/.test(
						text,
					);
				},
			},
			{
				name: "Mentions HTTP codes (200, 404, or 500)",
				field: "details",
				fn: (o) => {
					const text = `${o.summary} ${o.details}`;
					return /200|404|500/.test(text);
				},
			},
		],
	},
	{
		name: "Impossible Task (Graceful Failure)",
		agent: {
			name: "__eval_impossible",
			taskDescription:
				"Tell me the exact price of Bitcoin at 3:42pm tomorrow and the winning lottery numbers for next Friday.",
			cronSchedule: "0 0 * * *",
		},
		checks: [
			{
				name: "Returns success (no crash)",
				field: "status",
				fn: (o) => o.status === "success",
			},
			{
				name: "Acknowledges impossibility (cannot/impossible/unable/predict)",
				field: "summary",
				fn: (o) => {
					const text = `${o.summary} ${o.details}`.toLowerCase();
					return /cannot|can't|impossible|unable|predict|uncertain|no way|don't have/.test(
						text,
					);
				},
			},
			{
				name: "Does NOT hallucinate specific numbers as real predictions",
				field: "details",
				fn: (o) => {
					const text = `${o.summary} ${o.details}`;
					// Should not contain something like "Bitcoin will be $XX,XXX" without disclaimer
					const hasFakePrice = /bitcoin will be \$[\d,]+/i.test(text);
					const hasLotteryNums = /winning numbers.*(are|will be).*\d+/i.test(
						text,
					);
					return !hasFakePrice && !hasLotteryNums;
				},
			},
		],
	},
	{
		name: "Structured Output Completeness",
		agent: {
			name: "__eval_structured",
			taskDescription:
				"List the 3 most popular programming languages in 2025 and one key strength of each.",
			cronSchedule: "0 0 * * *",
		},
		checks: [
			{
				name: "Returns success",
				field: "status",
				fn: (o) => o.status === "success",
			},
			{
				name: "Summary field present and non-empty",
				field: "summary",
				fn: (o) => typeof o.summary === "string" && o.summary.length > 0,
			},
			{
				name: "Details field present and non-empty",
				field: "details",
				fn: (o) => typeof o.details === "string" && o.details.length > 0,
			},
			{
				name: "Execution has durationMs > 0",
				field: "meta",
				fn: (o) => o.durationMs > 0,
			},
			{
				name: "Execution has token counts > 0",
				field: "meta",
				fn: (o) => o.inputTokens > 0 && o.outputTokens > 0,
			},
			{
				name: "Mentions at least 2 languages (Python/JavaScript/TypeScript/Java/Go/Rust/C++)",
				field: "summary",
				fn: (o) => {
					const text = `${o.summary} ${o.details}`.toLowerCase();
					const langs = [
						"python",
						"javascript",
						"typescript",
						"java",
						"go",
						"rust",
						"c++",
						"c#",
					];
					return langs.filter((l) => text.includes(l)).length >= 2;
				},
			},
		],
	},
	{
		name: "Conciseness (Short Output)",
		agent: {
			name: "__eval_concise",
			taskDescription:
				"In exactly one sentence, explain what a REST API is.",
			cronSchedule: "0 0 * * *",
			systemPrompt: "Be extremely concise. Never use more than 2 sentences total across summary and details.",
		},
		checks: [
			{
				name: "Returns success",
				field: "status",
				fn: (o) => o.status === "success",
			},
			{
				name: "Summary is under 300 characters",
				field: "summary",
				fn: (o) => o.summary.length < 300,
			},
			{
				name: "Total output under 500 characters",
				field: "summary",
				fn: (o) => (o.summary + o.details).length < 500,
			},
			{
				name: "Mentions REST or API",
				field: "summary",
				fn: (o) => /rest|api/i.test(`${o.summary} ${o.details}`),
			},
		],
	},
];

// ── API Helpers ─────────────────────────────────────────────────────

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

async function setModel(agentId: number, model: string) {
	await fetch(`${BASE_URL}/agents/${agentId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ model }),
	});
}

// ── Eval Runner ─────────────────────────────────────────────────────

interface TestResult {
	testName: string;
	model: string;
	passed: number;
	total: number;
	checks: { name: string; passed: boolean }[];
	durationMs: number;
	outputTokens: number;
	error?: string;
}

async function runTestCase(
	tc: TestCase,
	agentId: number,
	model: string,
): Promise<TestResult> {
	const start = Date.now();

	try {
		const execResult = (await apiPost(`/agents/${agentId}/execute`)) as {
			status: string;
			executionId?: number;
			output?: { summary: string; details: string; data?: string };
			error?: string;
		};

		// Get execution details for meta fields
		let durationMs = Date.now() - start;
		let inputTokens = 0;
		let outputTokens = 0;

		if (execResult.executionId) {
			const executions = (await apiGet(
				`/agents/${agentId}/executions?limit=1`,
			)) as Array<{
				durationMs: number;
				inputTokens: number;
				outputTokens: number;
			}>;
			if (executions.length > 0) {
				durationMs = executions[0].durationMs ?? durationMs;
				inputTokens = executions[0].inputTokens ?? 0;
				outputTokens = executions[0].outputTokens ?? 0;
			}
		}

		const evalOutput: EvalOutput = {
			status: execResult.status,
			summary: execResult.output?.summary ?? "",
			details: execResult.output?.details ?? "",
			data: execResult.output?.data,
			durationMs,
			inputTokens,
			outputTokens,
		};

		const checkResults = tc.checks.map((check) => ({
			name: check.name,
			passed: check.fn(evalOutput),
		}));

		return {
			testName: tc.name,
			model,
			passed: checkResults.filter((c) => c.passed).length,
			total: checkResults.length,
			checks: checkResults,
			durationMs,
			outputTokens,
		};
	} catch (err) {
		return {
			testName: tc.name,
			model,
			passed: 0,
			total: tc.checks.length,
			checks: tc.checks.map((c) => ({ name: c.name, passed: false })),
			durationMs: Date.now() - start,
			outputTokens: 0,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
	const models = process.argv.slice(2);
	if (models.length === 0) {
		console.log(
			"Usage: npx tsx evals/run-evals.ts <model1> [model2] [model3] ...",
		);
		console.log("Example: npx tsx evals/run-evals.ts gemma3:12b gemma3:4b qwen2.5:7b");
		process.exit(1);
	}

	// Verify server is up
	try {
		const health = (await apiGet("/health")) as { status: string };
		if (health.status !== "ok") throw new Error("unhealthy");
	} catch {
		console.error("Error: Schedoodle server not running on", BASE_URL);
		process.exit(1);
	}

	console.log(`\n${"=".repeat(70)}`);
	console.log(`  SCHEDOODLE MODEL EVAL`);
	console.log(`  Models: ${models.join(", ")}`);
	console.log(`  Tests: ${TEST_CASES.length}`);
	console.log(`${"=".repeat(70)}\n`);

	// Create eval agents (once, reuse across models)
	const agentIds: Map<string, number> = new Map();

	for (const tc of TEST_CASES) {
		// Delete existing eval agent if present
		const existing = (await apiGet("/agents")) as Array<{
			id: number;
			name: string;
		}>;
		const old = existing.find((a) => a.name === tc.agent.name);
		if (old) await apiDelete(`/agents/${old.id}`);

		const created = (await apiPost("/agents", tc.agent)) as { id: number };
		agentIds.set(tc.name, created.id);
	}

	// Run all tests for each model
	const allResults: TestResult[] = [];

	for (const model of models) {
		console.log(`\n${"─".repeat(70)}`);
		console.log(`  MODEL: ${model}`);
		console.log(`${"─".repeat(70)}`);

		// Pull model if needed (ignore errors if already present)
		console.log(`  Ensuring ${model} is available...`);

		// Update all agents to use this model
		for (const [, id] of agentIds) {
			await setModel(id, model);
		}

		for (const tc of TEST_CASES) {
			const agentId = agentIds.get(tc.name)!;
			process.stdout.write(`  ${tc.name}... `);

			const result = await runTestCase(tc, agentId, model);
			allResults.push(result);

			const icon = result.passed === result.total ? "✓" : "✗";
			const secs = (result.durationMs / 1000).toFixed(1);
			console.log(
				`${icon} ${result.passed}/${result.total} (${secs}s, ${result.outputTokens} tok)`,
			);

			// Show failed checks
			for (const check of result.checks) {
				if (!check.passed) {
					console.log(`    ✗ ${check.name}`);
				}
			}

			if (result.error) {
				console.log(`    ERROR: ${result.error}`);
			}
		}
	}

	// ── Comparison Table ──────────────────────────────────────────────

	console.log(`\n${"=".repeat(70)}`);
	console.log(`  COMPARISON`);
	console.log(`${"=".repeat(70)}\n`);

	// Header
	const colWidth = 18;
	const testCol = 28;
	const header = [
		"Test".padEnd(testCol),
		...models.map((m) => m.padEnd(colWidth)),
	].join("│ ");
	console.log(header);
	console.log(
		"─".repeat(testCol) +
			("┼" + "─".repeat(colWidth + 1)).repeat(models.length),
	);

	// Rows per test
	for (const tc of TEST_CASES) {
		const cols = models.map((model) => {
			const r = allResults.find(
				(x) => x.testName === tc.name && x.model === model,
			);
			if (!r) return "—".padEnd(colWidth);
			const secs = (r.durationMs / 1000).toFixed(1);
			return `${r.passed}/${r.total}  ${secs}s  ${r.outputTokens}t`.padEnd(
				colWidth,
			);
		});
		console.log(`${tc.name.padEnd(testCol)}│ ${cols.join("│ ")}`);
	}

	// Totals row
	console.log(
		"─".repeat(testCol) +
			("┼" + "─".repeat(colWidth + 1)).repeat(models.length),
	);
	const totalCols = models.map((model) => {
		const modelResults = allResults.filter((r) => r.model === model);
		const passed = modelResults.reduce((s, r) => s + r.passed, 0);
		const total = modelResults.reduce((s, r) => s + r.total, 0);
		const totalTime = modelResults.reduce((s, r) => s + r.durationMs, 0);
		const totalTok = modelResults.reduce((s, r) => s + r.outputTokens, 0);
		return `${passed}/${total}  ${(totalTime / 1000).toFixed(0)}s  ${totalTok}t`.padEnd(
			colWidth,
		);
	});
	console.log(`${"TOTAL".padEnd(testCol)}│ ${totalCols.join("│ ")}`);

	console.log("");

	// Cleanup eval agents
	for (const [, id] of agentIds) {
		await apiDelete(`/agents/${id}`);
	}
	console.log("  Eval agents cleaned up.\n");
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
