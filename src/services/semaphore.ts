export interface SemaphoreStatus {
	active: number;
	queued: number;
	limit: number;
}

export function createSemaphore(limit: number) {
	let available = limit;
	let waiters: Array<() => void> = [];

	function acquire(): Promise<void> {
		if (available > 0) {
			available--;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			waiters.push(resolve);
		});
	}

	function release(): void {
		if (waiters.length > 0) {
			const next = waiters.shift()!;
			next();
		} else {
			available++;
		}
	}

	function getStatus(): SemaphoreStatus {
		return { active: limit - available, queued: waiters.length, limit };
	}

	function drain(): number {
		const count = waiters.length;
		waiters = [];
		return count;
	}

	function _reset(): void {
		available = limit;
		waiters = [];
	}

	return { acquire, release, getStatus, drain, _reset };
}
