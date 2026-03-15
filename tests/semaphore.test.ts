import { describe, expect, it } from "vitest";
import { createSemaphore, type SemaphoreStatus } from "../src/services/semaphore.js";

describe("createSemaphore", () => {
	it("acquire() resolves immediately when slots available", async () => {
		const sem = createSemaphore(2);
		// Should resolve without blocking
		await sem.acquire();
		const status = sem.getStatus();
		expect(status.active).toBe(1);
		expect(status.queued).toBe(0);
	});

	it("acquire() blocks when all slots occupied, resolves when a slot is released", async () => {
		const sem = createSemaphore(1);
		await sem.acquire(); // takes the only slot

		let blocked = true;
		const waitPromise = sem.acquire().then(() => {
			blocked = false;
		});

		// Give a tick — should still be blocked
		await new Promise((r) => setTimeout(r, 10));
		expect(blocked).toBe(true);
		expect(sem.getStatus().queued).toBe(1);

		// Release the slot
		sem.release();
		await waitPromise;
		expect(blocked).toBe(false);
	});

	it("FIFO ordering — first waiter resolves before second waiter", async () => {
		const sem = createSemaphore(1);
		await sem.acquire(); // slot taken

		const order: number[] = [];
		const p1 = sem.acquire().then(() => order.push(1));
		const p2 = sem.acquire().then(() => order.push(2));

		expect(sem.getStatus().queued).toBe(2);

		// Release two slots sequentially
		sem.release();
		await p1;
		sem.release();
		await p2;

		expect(order).toEqual([1, 2]);
	});

	it("getStatus() returns correct active/queued/limit counts", async () => {
		const sem = createSemaphore(3);

		let status: SemaphoreStatus = sem.getStatus();
		expect(status).toEqual({ active: 0, queued: 0, limit: 3 });

		await sem.acquire();
		status = sem.getStatus();
		expect(status).toEqual({ active: 1, queued: 0, limit: 3 });

		await sem.acquire();
		await sem.acquire();
		status = sem.getStatus();
		expect(status).toEqual({ active: 3, queued: 0, limit: 3 });

		// Queue one more
		const p = sem.acquire();
		status = sem.getStatus();
		expect(status).toEqual({ active: 3, queued: 1, limit: 3 });

		// Clean up
		sem.release();
		await p;
	});

	it("drain() clears all queued waiters and returns count; does NOT affect active slots", async () => {
		const sem = createSemaphore(1);
		await sem.acquire(); // slot taken

		// Queue 3 waiters
		sem.acquire();
		sem.acquire();
		sem.acquire();

		expect(sem.getStatus().queued).toBe(3);
		expect(sem.getStatus().active).toBe(1);

		const dropped = sem.drain();
		expect(dropped).toBe(3);
		expect(sem.getStatus().queued).toBe(0);
		expect(sem.getStatus().active).toBe(1); // active unchanged
	});

	it("_reset() restores semaphore to initial state", async () => {
		const sem = createSemaphore(2);
		await sem.acquire();
		await sem.acquire();
		sem.acquire(); // queued

		expect(sem.getStatus().active).toBe(2);
		expect(sem.getStatus().queued).toBe(1);

		sem._reset();

		const status = sem.getStatus();
		expect(status).toEqual({ active: 0, queued: 0, limit: 2 });
	});

	it("release() with no waiters increments available (no-op safety)", async () => {
		const sem = createSemaphore(2);
		await sem.acquire(); // active=1, available=1

		sem.release(); // no waiters, should just increment available
		const status = sem.getStatus();
		expect(status.active).toBe(0);
		expect(status.queued).toBe(0);
	});

	it("concurrent acquire calls beyond limit queue correctly", async () => {
		const sem = createSemaphore(2);

		// Acquire all slots
		await sem.acquire();
		await sem.acquire();

		// Fire off 5 concurrent acquires that should all queue
		const promises: Promise<void>[] = [];
		for (let i = 0; i < 5; i++) {
			promises.push(sem.acquire());
		}

		const status = sem.getStatus();
		expect(status.active).toBe(2);
		expect(status.queued).toBe(5);
		expect(status.limit).toBe(2);

		// Release all to clean up
		for (let i = 0; i < 7; i++) {
			sem.release();
		}
		await Promise.all(promises);
	});
});
