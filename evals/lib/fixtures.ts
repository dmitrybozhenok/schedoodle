/**
 * Fixture loader for JSONL eval datasets.
 *
 * Each line in a JSONL file is one EvalCase. Files are organized by domain:
 *   evals/fixtures/summarisation.jsonl
 *   evals/fixtures/instruction-following.jsonl
 *   evals/fixtures/error-handling.jsonl
 *   evals/fixtures/data-prefetch.jsonl
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalCase } from "./types.js";

/**
 * Load eval cases from a single JSONL file.
 */
export function loadFixtureFile(filePath: string): EvalCase[] {
	const content = readFileSync(filePath, "utf-8");
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("//"))
		.map((line, index) => {
			try {
				return JSON.parse(line) as EvalCase;
			} catch (err) {
				throw new Error(
					`Failed to parse line ${index + 1} in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		});
}

/**
 * Load all JSONL fixtures from the fixtures directory.
 */
export function loadAllFixtures(fixturesDir?: string): { file: string; cases: EvalCase[] }[] {
	const dir = fixturesDir ?? join(import.meta.dirname, "..", "fixtures");
	const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
	return files.map((file) => ({
		file,
		cases: loadFixtureFile(join(dir, file)),
	}));
}

/**
 * Load and filter fixtures by tags.
 */
export function loadFixturesByTags(tags: string[], fixturesDir?: string): EvalCase[] {
	const all = loadAllFixtures(fixturesDir);
	const cases = all.flatMap((f) => f.cases);
	if (tags.length === 0) return cases;
	return cases.filter((c) => tags.some((tag) => c.tags.includes(tag)));
}
