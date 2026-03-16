// --- Rate Limiter ---
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_LLM_MAX = 10;
export const RATE_LIMIT_GENERAL_MAX = 60;
export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 300_000;
export const RATE_LIMIT_STALE_THRESHOLD_MS = 120_000;

// --- Circuit Breaker ---
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
export const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 30_000;

// --- Prefetch ---
export const PREFETCH_TIMEOUT_MS = 10_000;
export const PREFETCH_MAX_RESPONSE_BYTES = 1_048_576;

// --- Executor ---
export const DEFAULT_EXECUTION_TIMEOUT_MS = 60_000;

// --- Notifications ---
export const TELEGRAM_MAX_MESSAGE_LENGTH = 3_800;
