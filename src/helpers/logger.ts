type LogLevel = "info" | "warn" | "error";

function formatMessage(prefix: string, message: string): string {
	return `[${prefix}] ${message}`;
}

function createLogger(prefix: string) {
	return {
		info: (message: string) => console.log(formatMessage(prefix, message)),
		warn: (message: string) => console.warn(formatMessage(prefix, message)),
		error: (message: string) => console.error(formatMessage(prefix, message)),
	};
}

export const log = {
	cron: createLogger("cron"),
	startup: createLogger("startup"),
	shutdown: createLogger("shutdown"),
	notify: createLogger("notify"),
	concurrency: createLogger("concurrency"),
	telegram: createLogger("telegram-bot"),
	mcp: createLogger("mcp"),
	// Generic for messages without a prefix
	info: (message: string) => console.log(message),
	warn: (message: string) => console.warn(message),
	error: (message: string) => console.error(message),
};
