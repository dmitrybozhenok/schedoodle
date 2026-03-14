import "dotenv/config";
import { z } from "zod";

export const envSchema = z.object({
	DATABASE_URL: z.string().default("./data/schedoodle.db"),
	ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
});

export function loadEnvFromRecord(record: Record<string, string | undefined>) {
	return envSchema.safeParse(record);
}

function loadEnv(): z.output<typeof envSchema> {
	const result = envSchema.safeParse(process.env);
	if (!result.success) {
		for (const issue of result.error.issues) {
			console.error(`Config error [${issue.path.join(".")}]: ${issue.message}`);
		}
		process.exit(1);
	}
	return result.data;
}

export const env = loadEnv();
