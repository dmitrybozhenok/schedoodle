/**
 * Shared types for the Schedoodle eval framework.
 */

/** A single eval test case loaded from a JSONL fixture. */
export interface EvalCase {
	id: string;
	name: string;
	agent: {
		name: string;
		taskDescription: string;
		cronSchedule: string;
		systemPrompt?: string;
		model?: string;
	};
	/** Tags for data slicing: e.g., ["simple", "summarisation", "no-urls"] */
	tags: string[];
	/** Deterministic checks (Layer 1) */
	checks: CheckDef[];
	/** AI-as-judge criteria (Layer 2). If absent, skip AI scoring. */
	judgeCriteria?: JudgeCriterion[];
	/** Expected output for factual consistency scoring (optional reference). */
	referenceOutput?: string;
	/** Thresholds for cost/latency regression detection. */
	thresholds?: {
		maxDurationMs?: number;
		maxOutputTokens?: number;
		maxCostUsd?: number;
	};
}

export interface CheckDef {
	name: string;
	field: "summary" | "details" | "status" | "data" | "meta";
	/** A serializable check type instead of a function (for JSONL compatibility). */
	type: CheckType;
	/** Parameters for the check type. */
	params?: Record<string, unknown>;
}

export type CheckType =
	| "equals"
	| "contains"
	| "regex"
	| "minLength"
	| "maxLength"
	| "notContainsRegex"
	| "minKeywordCount"
	| "greaterThan";

export interface JudgeCriterion {
	name: string;
	/** Rubric description for the AI judge. */
	rubric: string;
	/** Scoring scale: binary (0/1) or likert (1-5). */
	scale: "binary" | "likert";
	/** Minimum acceptable score (e.g., 1 for binary pass, 3 for likert). */
	minScore: number;
}

/** The output collected from executing an eval case. */
export interface EvalOutput {
	status: string;
	summary: string;
	details: string;
	data?: string;
	durationMs: number;
	inputTokens: number;
	outputTokens: number;
	estimatedCost: number;
}

/** Result of a single eval case execution. */
export interface EvalResult {
	caseId: string;
	caseName: string;
	model: string;
	tags: string[];
	output: EvalOutput;
	/** Layer 1: deterministic check results. */
	checks: { name: string; passed: boolean }[];
	/** Layer 2: AI-as-judge scores. */
	judgeScores?: { criterion: string; score: number; reasoning: string }[];
	/** Whether all checks and judge criteria met their thresholds. */
	passed: boolean;
	/** Threshold violations. */
	thresholdViolations?: string[];
	error?: string;
}

/** Aggregate eval run summary. */
export interface EvalRunSummary {
	runId: string;
	timestamp: string;
	model: string;
	totalCases: number;
	passedCases: number;
	failedCases: number;
	/** Pass rate by tag slice. */
	slices: Record<string, { total: number; passed: number; rate: number }>;
	/** Aggregate metrics. */
	metrics: {
		avgDurationMs: number;
		p95DurationMs: number;
		avgOutputTokens: number;
		totalCostUsd: number;
		schemaPassRate: number;
		avgJudgeScore?: number;
	};
	results: EvalResult[];
}
