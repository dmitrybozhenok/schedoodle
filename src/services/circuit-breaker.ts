export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
	failureThreshold?: number;
	resetTimeoutMs?: number;
	name: string;
}

export interface CircuitBreakerStatus {
	state: CircuitState;
	failures: number;
	lastFailureTime: number | null;
	name: string;
}

export class CircuitBreakerOpenError extends Error {
	override name = "CircuitBreakerOpenError";

	constructor(breakerName: string) {
		super(`Circuit breaker "${breakerName}" is OPEN — call rejected`);
	}
}

export function createCircuitBreaker(options: CircuitBreakerOptions) {
	const failureThreshold = options.failureThreshold ?? 3;
	const resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
	const name = options.name;

	let state: CircuitState = "CLOSED";
	let failures = 0;
	let lastFailureTime: number | null = null;
	let openedAt: number | null = null;

	function resolveState(): CircuitState {
		if (state === "OPEN" && openedAt !== null && Date.now() - openedAt >= resetTimeoutMs) {
			state = "HALF_OPEN";
		}
		return state;
	}

	function getStatus(): CircuitBreakerStatus {
		return {
			state: resolveState(),
			failures,
			lastFailureTime,
			name,
		};
	}

	async function execute<T>(action: () => Promise<T>): Promise<T> {
		const currentState = resolveState();

		if (currentState === "OPEN") {
			throw new CircuitBreakerOpenError(name);
		}

		try {
			const result = await action();
			// Success: close circuit, reset failures
			state = "CLOSED";
			failures = 0;
			return result;
		} catch (error) {
			if (currentState === "HALF_OPEN") {
				// Probe failed: re-open but do NOT reset lastFailureTime
				// Update openedAt so the cooldown timer restarts from now
				state = "OPEN";
				openedAt = Date.now();
			} else {
				// CLOSED state: increment failures
				failures++;
				lastFailureTime = Date.now();
				if (failures >= failureThreshold) {
					state = "OPEN";
					openedAt = Date.now();
				}
			}
			throw error;
		}
	}

	return { execute, getStatus };
}
