/**
 * Deterministic check evaluators (Layer 1).
 *
 * These map serializable CheckDef types to actual evaluation functions,
 * enabling JSONL fixture files to define checks without inline code.
 */
import type { CheckDef, EvalOutput } from "./types.js";

function getField(output: EvalOutput, field: CheckDef["field"]): string {
	if (field === "status") return output.status;
	if (field === "summary") return output.summary;
	if (field === "details") return output.details;
	if (field === "data") return output.data ?? "";
	// "meta" — combine all text fields for meta checks
	return `${output.summary} ${output.details} ${output.data ?? ""}`;
}

function getNumericField(output: EvalOutput, field: CheckDef["field"]): number {
	if (field === "meta") {
		// For numeric meta checks, use durationMs or outputTokens based on context
		return 0;
	}
	return getField(output, field).length;
}

export function evaluateCheck(check: CheckDef, output: EvalOutput): boolean {
	const value = getField(output, check.field);
	const params = check.params ?? {};

	switch (check.type) {
		case "equals":
			return value === String(params.expected);

		case "contains":
			return value.toLowerCase().includes(String(params.text).toLowerCase());

		case "regex":
			return new RegExp(String(params.pattern), String(params.flags ?? "i")).test(value);

		case "minLength":
			return value.length >= Number(params.min);

		case "maxLength":
			return value.length <= Number(params.max);

		case "notContainsRegex":
			return !new RegExp(String(params.pattern), String(params.flags ?? "i")).test(value);

		case "minKeywordCount": {
			const keywords = params.keywords as string[];
			const text = value.toLowerCase();
			const count = keywords.filter((k) => text.includes(k.toLowerCase())).length;
			return count >= Number(params.min);
		}

		case "greaterThan": {
			let numValue: number;
			if (params.metric === "durationMs") numValue = output.durationMs;
			else if (params.metric === "inputTokens") numValue = output.inputTokens;
			else if (params.metric === "outputTokens") numValue = output.outputTokens;
			else numValue = getNumericField(output, check.field);
			return numValue > Number(params.value);
		}

		default:
			console.warn(`Unknown check type: ${check.type}`);
			return false;
	}
}
