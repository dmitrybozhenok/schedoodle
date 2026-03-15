/**
 * Eval report formatter — prints results to console with data slicing.
 *
 * Output format inspired by Chip Huyen's evaluation pipeline design:
 *   - Overall pass rate
 *   - Per-slice breakdown (by tag)
 *   - Cost/latency metrics
 *   - Failed case details
 *   - AI judge reasoning (when available)
 */
import type { EvalRunSummary } from "./types.js";

function bar(rate: number, width = 20): string {
	const filled = Math.round(rate * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

function pct(rate: number): string {
	return `${(rate * 100).toFixed(0)}%`;
}

export function printReport(summary: EvalRunSummary): void {
	const { metrics } = summary;

	console.log(`\n${"═".repeat(70)}`);
	console.log("  SCHEDOODLE EVAL REPORT");
	console.log(`${"═".repeat(70)}`);
	console.log(`  Run:    ${summary.runId}`);
	console.log(`  Model:  ${summary.model}`);
	console.log(`  Time:   ${summary.timestamp}`);
	console.log(`  Cases:  ${summary.totalCases}`);

	// ── Overall ──────────────────────────────────────────────────
	const overallRate = summary.totalCases > 0 ? summary.passedCases / summary.totalCases : 0;
	console.log(`\n${"─".repeat(70)}`);
	console.log("  OVERALL");
	console.log(`${"─".repeat(70)}`);
	console.log(
		`  Pass rate:  ${bar(overallRate)} ${pct(overallRate)} (${summary.passedCases}/${summary.totalCases})`,
	);
	console.log(`  Schema:     ${pct(metrics.schemaPassRate)}`);
	if (metrics.avgJudgeScore !== undefined) {
		console.log(`  Avg judge:  ${metrics.avgJudgeScore.toFixed(2)}/5`);
	}

	// ── Metrics ──────────────────────────────────────────────────
	console.log(`\n${"─".repeat(70)}`);
	console.log("  METRICS");
	console.log(`${"─".repeat(70)}`);
	console.log(`  Latency (avg):    ${(metrics.avgDurationMs / 1000).toFixed(1)}s`);
	console.log(`  Latency (p95):    ${(metrics.p95DurationMs / 1000).toFixed(1)}s`);
	console.log(`  Avg tokens (out): ${metrics.avgOutputTokens.toFixed(0)}`);
	console.log(`  Total cost:       $${metrics.totalCostUsd.toFixed(4)}`);

	// ── Slices ───────────────────────────────────────────────────
	const sliceEntries = Object.entries(summary.slices).sort((a, b) => a[0].localeCompare(b[0]));

	if (sliceEntries.length > 0) {
		console.log(`\n${"─".repeat(70)}`);
		console.log("  DATA SLICES");
		console.log(`${"─".repeat(70)}`);

		const tagCol = 24;
		console.log(`  ${"Tag".padEnd(tagCol)}${"Pass Rate".padEnd(14)}${"Count".padEnd(10)}`);
		console.log(`  ${"─".repeat(tagCol + 24)}`);
		for (const [tag, data] of sliceEntries) {
			const rateStr = `${pct(data.rate)} (${data.passed}/${data.total})`;
			console.log(`  ${tag.padEnd(tagCol)}${rateStr.padEnd(14)}${String(data.total).padEnd(10)}`);
		}
	}

	// ── Failed Cases ─────────────────────────────────────────────
	const failedResults = summary.results.filter((r) => !r.passed);
	if (failedResults.length > 0) {
		console.log(`\n${"─".repeat(70)}`);
		console.log(`  FAILURES (${failedResults.length})`);
		console.log(`${"─".repeat(70)}`);

		for (const result of failedResults) {
			console.log(`\n  ✗ ${result.caseName} [${result.caseId}]`);

			if (result.error) {
				console.log(`    ERROR: ${result.error}`);
				continue;
			}

			// Failed deterministic checks
			const failedChecks = result.checks.filter((c) => !c.passed);
			for (const check of failedChecks) {
				console.log(`    ✗ Check: ${check.name}`);
			}

			// Failed judge criteria
			if (result.judgeScores) {
				for (const js of result.judgeScores) {
					if (js.reasoning.startsWith("SKIPPED")) continue;
					// Find the criterion to check minScore
					const caseObj = summary.results.find((r) => r.caseId === result.caseId);
					if (caseObj) {
						console.log(`    Judge [${js.criterion}]: ${js.score} — ${js.reasoning.slice(0, 120)}`);
					}
				}
			}

			// Threshold violations
			if (result.thresholdViolations) {
				for (const v of result.thresholdViolations) {
					console.log(`    ⚠ Threshold: ${v}`);
				}
			}
		}
	}

	// ── Per-Case Table ───────────────────────────────────────────
	console.log(`\n${"─".repeat(70)}`);
	console.log("  CASE DETAILS");
	console.log(`${"─".repeat(70)}`);

	const nameCol = 32;
	const checksCol = 12;
	const judgeCol = 10;
	const latCol = 8;
	const tokCol = 8;

	console.log(
		`  ${"Case".padEnd(nameCol)}${"Checks".padEnd(checksCol)}${"Judge".padEnd(judgeCol)}${"Time".padEnd(latCol)}${"Tokens".padEnd(tokCol)}`,
	);
	console.log(`  ${"─".repeat(nameCol + checksCol + judgeCol + latCol + tokCol)}`);

	for (const r of summary.results) {
		const icon = r.passed ? "✓" : "✗";
		const passedChecks = r.checks.filter((c) => c.passed).length;
		const checksStr = `${passedChecks}/${r.checks.length}`;

		let judgeStr = "—";
		if (r.judgeScores && r.judgeScores.length > 0) {
			const validScores = r.judgeScores.filter((js) => !js.reasoning.startsWith("SKIPPED"));
			if (validScores.length > 0) {
				const avg = validScores.reduce((a, b) => a + b.score, 0) / validScores.length;
				judgeStr = avg.toFixed(1);
			}
		}

		const latStr = `${(r.output.durationMs / 1000).toFixed(1)}s`;
		const tokStr = String(r.output.outputTokens);

		console.log(
			`  ${icon} ${r.caseName.slice(0, nameCol - 3).padEnd(nameCol - 2)}${checksStr.padEnd(checksCol)}${judgeStr.padEnd(judgeCol)}${latStr.padEnd(latCol)}${tokStr.padEnd(tokCol)}`,
		);
	}

	console.log(`\n${"═".repeat(70)}\n`);
}

/**
 * Write results to a JSON file for historical tracking.
 */
export function toJson(summary: EvalRunSummary): string {
	return JSON.stringify(summary, null, 2);
}
