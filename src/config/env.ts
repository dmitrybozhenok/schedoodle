import "dotenv/config";
import { z } from "zod";

export const envSchema = z
	.object({
		DATABASE_URL: z.string().default("./data/schedoodle.db"),
		LLM_PROVIDER: z.enum(["anthropic", "ollama"]).default("anthropic"),
		ANTHROPIC_API_KEY: z.string().optional(),
		OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434/api"),
		PORT: z.coerce.number().default(3000),
		RESEND_API_KEY: z.string().optional(),
		NOTIFICATION_EMAIL: z.string().email().optional(),
		NOTIFICATION_FROM: z.string().optional(),
		SMTP_HOST: z.string().optional(),
		SMTP_PORT: z.coerce.number().optional(),
		BRAVE_API_KEY: z.string().optional(),
		AUTH_TOKEN: z.string().optional(),
		TELEGRAM_BOT_TOKEN: z.string().optional(),
		TELEGRAM_CHAT_ID: z.string().optional(),
		RETENTION_DAYS: z.coerce.number().min(1).default(30),
		MAX_CONCURRENT_LLM: z.coerce.number().min(1).default(3),
	})
	.refine(
		(data) =>
			data.LLM_PROVIDER !== "anthropic" ||
			(data.ANTHROPIC_API_KEY && data.ANTHROPIC_API_KEY.length > 0),
		{
			message: "ANTHROPIC_API_KEY is required when LLM_PROVIDER is anthropic",
			path: ["ANTHROPIC_API_KEY"],
		},
	);

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
