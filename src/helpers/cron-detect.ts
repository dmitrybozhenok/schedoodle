import { Cron } from "croner";

const CRON_CHARS = /^[0-9*/,\-?LW#]+$/;

/**
 * Detect whether input is a valid cron expression (as opposed to natural language).
 * Checks field count, character validity, and validates with croner.
 */
export function isCronExpression(input: string): boolean {
	const trimmed = input.trim();
	if (trimmed.length === 0) return false;

	const fields = trimmed.split(/\s+/);
	if (fields.length < 5 || fields.length > 7) return false;

	// Each field must only contain cron-valid characters
	if (!fields.every((f) => CRON_CHARS.test(f))) return false;

	// Final validation with croner
	try {
		const job = new Cron(trimmed, { paused: true });
		job.stop();
		return true;
	} catch {
		return false;
	}
}
