import { beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreakerOpenError, createCircuitBreaker } from "../src/services/circuit-breaker.js";

describe("createCircuitBreaker", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it("passes calls through when CLOSED", async () => {
		const cb = createCircuitBreaker({ name: "test" });
		const result = await cb.execute(() => Promise.resolve("ok"));
		expect(result).toBe("ok");
	});

	it("starts in CLOSED state with 0 failures", () => {
		const cb = createCircuitBreaker({ name: "test" });
		const status = cb.getStatus();
		expect(status.state).toBe("CLOSED");
		expect(status.failures).toBe(0);
		expect(status.name).toBe("test");
	});

	it("increments failure count on action rejection", async () => {
		const cb = createCircuitBreaker({ name: "test" });
		await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow("fail");
		expect(cb.getStatus().failures).toBe(1);
	});

	it("trips to OPEN after 3 consecutive failures (default threshold)", async () => {
		const cb = createCircuitBreaker({ name: "test" });
		for (let i = 0; i < 3; i++) {
			await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
		}
		expect(cb.getStatus().state).toBe("OPEN");
	});

	it("OPEN state throws CircuitBreakerOpenError immediately without executing action", async () => {
		const cb = createCircuitBreaker({ name: "test", failureThreshold: 1 });
		await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();

		const action = vi.fn(() => Promise.resolve("should not run"));
		await expect(cb.execute(action)).rejects.toThrow(CircuitBreakerOpenError);
		expect(action).not.toHaveBeenCalled();
	});

	it("CircuitBreakerOpenError has correct name property", async () => {
		const cb = createCircuitBreaker({ name: "test", failureThreshold: 1 });
		await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();

		try {
			await cb.execute(() => Promise.resolve("x"));
		} catch (e) {
			expect(e).toBeInstanceOf(CircuitBreakerOpenError);
			expect((e as Error).name).toBe("CircuitBreakerOpenError");
		}
	});

	it("transitions from OPEN to HALF_OPEN after resetTimeoutMs elapses", async () => {
		vi.useFakeTimers();
		const cb = createCircuitBreaker({ name: "test", failureThreshold: 1, resetTimeoutMs: 1000 });
		await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
		expect(cb.getStatus().state).toBe("OPEN");

		vi.advanceTimersByTime(1001);
		expect(cb.getStatus().state).toBe("HALF_OPEN");
	});

	it("HALF_OPEN: successful probe closes the circuit (resets failures to 0)", async () => {
		vi.useFakeTimers();
		const cb = createCircuitBreaker({ name: "test", failureThreshold: 1, resetTimeoutMs: 1000 });
		await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();

		vi.advanceTimersByTime(1001);
		expect(cb.getStatus().state).toBe("HALF_OPEN");

		const result = await cb.execute(() => Promise.resolve("recovered"));
		expect(result).toBe("recovered");
		expect(cb.getStatus().state).toBe("CLOSED");
		expect(cb.getStatus().failures).toBe(0);
	});

	it("HALF_OPEN: failed probe re-opens without resetting lastFailureTime", async () => {
		vi.useFakeTimers();
		const cb = createCircuitBreaker({ name: "test", failureThreshold: 1, resetTimeoutMs: 1000 });
		await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();

		const statusAfterTrip = cb.getStatus();
		const originalFailureTime = statusAfterTrip.lastFailureTime;

		vi.advanceTimersByTime(1001);
		expect(cb.getStatus().state).toBe("HALF_OPEN");

		// Probe fails
		await expect(cb.execute(() => Promise.reject(new Error("still down")))).rejects.toThrow();
		const statusAfterProbe = cb.getStatus();
		expect(statusAfterProbe.state).toBe("OPEN");
		// lastFailureTime should NOT be reset (prevents infinite postponement)
		expect(statusAfterProbe.lastFailureTime).toBe(originalFailureTime);
	});

	it("resets failure count on success in CLOSED state", async () => {
		const cb = createCircuitBreaker({ name: "test" });
		// Two failures, then a success should reset
		await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
		await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
		expect(cb.getStatus().failures).toBe(2);

		await cb.execute(() => Promise.resolve("ok"));
		expect(cb.getStatus().failures).toBe(0);
	});

	it("getStatus returns { state, failures, lastFailureTime, name }", () => {
		const cb = createCircuitBreaker({ name: "myBreaker" });
		const status = cb.getStatus();
		expect(status).toHaveProperty("state");
		expect(status).toHaveProperty("failures");
		expect(status).toHaveProperty("lastFailureTime");
		expect(status).toHaveProperty("name");
		expect(status.name).toBe("myBreaker");
	});

	it("uses custom failureThreshold", async () => {
		const cb = createCircuitBreaker({ name: "test", failureThreshold: 5 });
		for (let i = 0; i < 4; i++) {
			await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
		}
		expect(cb.getStatus().state).toBe("CLOSED");

		await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
		expect(cb.getStatus().state).toBe("OPEN");
	});
});
