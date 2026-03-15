#!/usr/bin/env npx tsx
/**
 * Schedoodle Eval Framework CLI
 *
 * Three-layer evaluation inspired by Chip Huyen's AI Engineering (Ch. 4):
 *   Layer 1: Deterministic checks (schema validation, keywords, regex)
 *   Layer 2: AI-as-judge scoring (relevance, accuracy, instruction-following)
 *   Layer 3: Threshold regression detection (cost, latency, tokens)
 *
 * Usage:
 *   npx tsx evals/eval.ts                           # Run all fixtures, Layer 1 only
 *   npx tsx evals/eval.ts --judge                   # Run with AI-as-judge (Layer 2)
 *   npx tsx evals/eval.ts --model gemma3:4b         # Run against a specific model
 *   npx tsx evals/eval.ts --tags simple             # Filter by tag
 *   npx tsx evals/eval.ts --judge --model gemma3:4b --output results.json
 *
 * Requires: Schedoodle server running on localhost:3000
 *
 * Eval dataset: evals/fixtures/*.jsonl (one EvalCase per line)
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { loadAllFixtures, loadFixturesByTags } from "./lib/fixtures.js";
import { printReport, toJson } from "./lib/reporter.js";
import { runEvalSuite } from "./lib/runner.js";
import type { JudgeProvider } from "./scorers/ai-judge.js";

function parseArgs(): {
	model?: string;
	tags: string[];
	enableJudge: boolean;
	judgeModel?: string;
	judgeProvider?: JudgeProvider;
	output?: string;
} {
	const args = process.argv.slice(2);
	let model: string | undefined;
	let tags: string[] = [];
	let enableJudge = false;
	let judgeModel: string | undefined;
	let judgeProvider: JudgeProvider | undefined;
	let output: string | undefined;

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--model":
				model = args[++i];
				break;
			case "--tags":
				tags = (args[++i] ?? "").split(",").filter(Boolean);
				break;
			case "--judge":
				enableJudge = true;
				break;
			case "--judge-model":
				judgeModel = args[++i];
				break;
			case "--judge-provider":
				judgeProvider = args[++i] as JudgeProvider;
				break;
			case "--output":
				output = args[++i];
				break;
			case "--help":
				console.log(`
Schedoodle Eval Framework

Usage: npx tsx evals/eval.ts [options]

Options:
  --model <name>            Model to evaluate (e.g., gemma3:4b, claude-sonnet-4-20250514)
  --tags <tag1,tag2>        Filter cases by tags (comma-separated)
  --judge                   Enable AI-as-judge scoring (Layer 2)
  --judge-provider <name>   Judge provider: gemini (default) or anthropic
  --judge-model <name>      Judge model (default: gemini-3.1-flash-lite-preview or claude-sonnet-4-20250514)
  --output <file>           Write JSON results to file
  --help                    Show this help

Environment variables:
  GEMINI_API_KEY            API key for Gemini judge (preferred)
  ANTHROPIC_API_KEY         API key for Anthropic judge (fallback)

Available tags:
  simple, summarisation, conciseness, no-urls,
  instruction-following, persona, system-prompt, tone, count-constraint,
  error-handling, impossible, hallucination, ambiguous, edge-case, minimal

Examples:
  npx tsx evals/eval.ts                                    # All cases, deterministic only
  npx tsx evals/eval.ts --judge                            # All cases + AI judge (Gemini)
  npx tsx evals/eval.ts --judge --judge-provider anthropic # Use Anthropic as judge
  npx tsx evals/eval.ts --model gemma3:4b --judge          # Test Ollama model, Gemini judges
  npx tsx evals/eval.ts --output results.json              # Save results to file
`);
				process.exit(0);
		}
	}

	return { model, tags, enableJudge, judgeModel, judgeProvider, output };
}

function resolveJudgeLabel(provider?: JudgeProvider, model?: string): string {
	if (provider === "anthropic") return model ?? "claude-sonnet-4-20250514";
	if (provider === "gemini") return model ?? "gemini-3.1-flash-lite-preview";
	// Auto-detect
	if (process.env.GEMINI_API_KEY) return model ?? "gemini-3.1-flash-lite-preview";
	if (process.env.ANTHROPIC_API_KEY) return model ?? "claude-sonnet-4-20250514";
	return "no API key found";
}

async function main() {
	const opts = parseArgs();

	// Load fixtures
	const cases =
		opts.tags.length > 0
			? loadFixturesByTags(opts.tags)
			: loadAllFixtures().flatMap((f) => f.cases);

	if (cases.length === 0) {
		console.error("No eval cases found. Check evals/fixtures/*.jsonl");
		process.exit(1);
	}

	const judgeLabel = resolveJudgeLabel(opts.judgeProvider, opts.judgeModel);

	console.log(`\n${"═".repeat(70)}`);
	console.log("  SCHEDOODLE EVAL FRAMEWORK");
	console.log(`${"═".repeat(70)}`);
	console.log(`  Model:   ${opts.model ?? "server default"}`);
	console.log(`  Cases:   ${cases.length}`);
	console.log(`  Judge:   ${opts.enableJudge ? `enabled (${judgeLabel})` : "disabled"}`);
	if (opts.tags.length > 0) {
		console.log(`  Tags:    ${opts.tags.join(", ")}`);
	}
	console.log(`${"═".repeat(70)}\n`);

	// Run eval suite
	const startTime = Date.now();
	console.log(`  Running ${cases.length} cases...`);

	const summary = await runEvalSuite(cases, {
		model: opts.model,
		enableJudge: opts.enableJudge,
		judgeModel: opts.judgeModel,
		judgeProvider: opts.judgeProvider,
	});

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(`  Completed ${cases.length} cases in ${elapsed}s\n`);

	// Print report
	printReport(summary);

	// Save to file if requested
	if (opts.output) {
		writeFileSync(opts.output, toJson(summary));
		console.log(`  Results saved to: ${opts.output}\n`);
	}

	// Exit with non-zero if any failures
	process.exit(summary.failedCases > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
