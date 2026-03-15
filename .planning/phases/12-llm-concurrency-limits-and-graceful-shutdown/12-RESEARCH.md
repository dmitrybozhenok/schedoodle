# Phase 12: LLM Concurrency Limits and Graceful Shutdown - Research

**Researched:** 2026-03-15
**Domain:** Async concurrency control, graceful process shutdown, Node.js signal handling
**Confidence:** HIGH

## Summary

This phase adds a counting semaphore to limit concurrent LLM calls and extends the existing shutdown handler to drain in-flight executions before exit. The technical domain is well-understood -- Promise-based semaphores are a ~30-line pattern, and Node.js signal handling with timeout-based drain is a standard server lifecycle concern.

The project already has a custom circuit breaker (~85 lines) that establishes the pattern: module-level singleton, factory function, reset for testing, no external dependencies. The semaphore follows this exact style. The shutdown handler in `src/index.ts` already handles SIGINT/SIGTERM -- it needs extension, not replacement. The health endpoint already aggregates circuit breaker and agent stats -- the concurrency section slots in alongside.

**Primary recommendation:** Build a ~30-line counting semaphore module (`src/services/semaphore.ts`) following the circuit breaker's singleton pattern, wrap `executeAgent` calls, extend the existing `shutdown()` function with a drain-and-timeout loop, and add concurrency stats to the health response.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Global limit of 3 concurrent LLM calls (MAX_CONCURRENT_LLM env var, default 3)
- Custom semaphore implementation (~30 lines, no external dependencies) -- matches project's custom circuit breaker pattern
- Shared pool for both scheduled cron executions and manual POST /agents/:id/execute
- Semaphore wraps the executeAgent call -- acquire before execution, release after
- On SIGINT/SIGTERM: stop accepting new executions, wait up to 30 seconds for in-flight calls to finish
- Log on shutdown: '[shutdown] Waiting for N in-flight executions to complete (30s timeout)...'
- On all complete: '[shutdown] All executions complete, exiting'
- On timeout: mark remaining 'running' records as 'failure' with error 'Shutdown timeout exceeded', then force exit
- Don't rely on next startup's stale cleanup -- mark records inline before exiting
- When all slots full, new executions wait in FIFO queue (semaphore's acquire() blocks naturally)
- Manual execute (POST /agents/:id/execute) transparently waits -- HTTP request takes longer, no 202/polling
- On shutdown, drop queued (not-yet-started) executions -- only wait for in-flight calls
- Dropped scheduled executions will trigger again on next cron cycle after restart
- Add 'concurrency' section to GET /health: { active: N, queued: N, limit: N }
- Log only when an execution has to wait: '[concurrency] Slot full (3/3 active), agent "X" queued'
- Don't log normal acquire/release -- too noisy (matches Phase 11's conditional logging pattern)
- Add 'shutting_down: true/false' to health response; return 503 when shutting down
- Full concurrency is normal operation -- don't degrade top-level health status for saturated slots

### Claude's Discretion
- Exact semaphore implementation details (Promise-based acquire/release pattern)
- How to track active execution count for the shutdown drain (counter vs Set of promises)
- Where the semaphore singleton lives (new module vs extend executor.ts)
- Integration order of concurrency wrapping with circuit breaker

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

No formal requirement IDs were assigned for Phase 12. The following derived requirements map to CONTEXT.md decisions:

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONC-01 | Counting semaphore limits concurrent LLM calls to MAX_CONCURRENT_LLM (default 3) | Semaphore pattern, env config pattern |
| CONC-02 | Semaphore wraps executeAgent for both cron and manual triggers | Executor integration pattern |
| CONC-03 | Queued executions wait in FIFO order when all slots are full | Promise-based queue in semaphore |
| SHUT-01 | SIGINT/SIGTERM stops accepting new work, drains in-flight with 30s timeout | Shutdown drain pattern |
| SHUT-02 | On timeout, mark remaining 'running' records as 'failure' before force exit | DB cleanup on shutdown |
| SHUT-03 | Queued (not-yet-started) executions are dropped on shutdown | Semaphore drain/abort pattern |
| OBSV-01 | Health endpoint includes concurrency: { active, queued, limit } | Health route extension |
| OBSV-02 | Health endpoint includes shutting_down flag; returns 503 during shutdown | Health route extension |
| OBSV-03 | Log when execution waits for slot: '[concurrency] Slot full...' | Conditional logging pattern |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (no new deps) | - | Custom semaphore | Project pattern: zero-dependency solutions (circuit breaker precedent) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zod | 4.3.6 | MAX_CONCURRENT_LLM env validation | Already used in env.ts |
| better-sqlite3 | 12.8.0 | Mark stale records on shutdown | Already used throughout |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom semaphore | async-sema (Vercel) | Well-tested but adds dependency; ~30 lines custom is trivial and matches circuit-breaker pattern |
| Custom semaphore | p-limit | Popular but opaque; project prefers visible implementations |
| Custom shutdown | http-graceful-shutdown | Overkill; project already has shutdown(); just needs drain logic |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  services/
    semaphore.ts         # NEW: Counting semaphore with FIFO queue
    executor.ts          # MODIFIED: Wrap executeAgent with semaphore
    scheduler.ts         # UNCHANGED (calls executeAgent which is wrapped)
    startup.ts           # UNCHANGED
  config/
    env.ts               # MODIFIED: Add MAX_CONCURRENT_LLM
  routes/
    health.ts            # MODIFIED: Add concurrency stats + shutting_down
  index.ts               # MODIFIED: Extend shutdown() with drain logic
tests/
  semaphore.test.ts      # NEW: Semaphore unit tests
  shutdown.test.ts       # NEW: Shutdown drain tests
```

### Pattern 1: Counting Semaphore with FIFO Queue

**What:** A Promise-based semaphore that limits concurrency and queues excess callers.
**When to use:** When N async operations must be bounded to M concurrent slots.
**Example:**
```typescript
// Source: verified pattern from multiple implementations
// (dev.to/thegravityguy, alexn.org/blog, github.com/vercel/async-sema)

export interface SemaphoreStatus {
  active: number;
  queued: number;
  limit: number;
}

export function createSemaphore(limit: number) {
  let available = limit;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (available > 0) {
      available--;
      return;
    }
    return new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  }

  function release(): void {
    if (waiters.length > 0) {
      const next = waiters.shift()!;
      // Don't increment available -- the slot transfers directly to the next waiter
      next();
    } else {
      available++;
    }
  }

  function getStatus(): SemaphoreStatus {
    return {
      active: limit - available - waiters.length,
      // Correction: active = slots in use = limit - available
      // But waiters are also "using" a conceptual slot (they got resolved and are now executing)
      // Actually: active = limit - available, queued = waiters.length
      active: limit - available,
      queued: waiters.length,
      limit,
    };
  }

  /** Drop all queued waiters (for shutdown). Returns count of dropped. */
  function drain(): number {
    const dropped = waiters.length;
    waiters.length = 0;
    return dropped;
  }

  function _reset(): void {
    available = limit;
    waiters.length = 0;
  }

  return { acquire, release, getStatus, drain, _reset };
}
```

**Key insight on `active` count:**
- When `acquire()` returns immediately, `available` decreases by 1. Active = `limit - available`.
- When a waiter is resolved via `release()`, the slot transfers directly (available stays the same, waiter count decreases by 1). Active still = `limit - available`.
- `queued` = `waiters.length` (those waiting for a slot).

**FIFO guarantee:** `waiters.shift()` ensures first-in-first-out order.

### Pattern 2: Semaphore-Wrapped Execution

**What:** The semaphore wraps around `executeAgent`, not the LLM call itself.
**When to use:** When the entire execution lifecycle (prefetch + LLM + notification) should count as one slot.
**Example:**
```typescript
// In executor.ts -- wrap executeAgent
import { createSemaphore } from "./semaphore.js";
import { env } from "../config/env.js";

const llmSemaphore = createSemaphore(env.MAX_CONCURRENT_LLM);

export async function executeAgent(agent: Agent, db: Database): Promise<ExecuteResult> {
  // Log only when queued (conditional logging pattern from Phase 11)
  const status = llmSemaphore.getStatus();
  if (status.active >= status.limit) {
    console.log(`[concurrency] Slot full (${status.active}/${status.limit} active), agent "${agent.name}" queued`);
  }

  await llmSemaphore.acquire();
  try {
    return await executeAgentInner(agent, db);
  } finally {
    llmSemaphore.release();
  }
}
```

**Integration with circuit breaker:** The semaphore wraps the outer `executeAgent`. The circuit breaker wraps the inner `llmBreaker.execute()` call. Order: semaphore acquire -> prefetch -> circuit breaker -> LLM call -> circuit breaker release -> notification -> semaphore release. This is correct because:
1. The semaphore gates the entire execution, preventing too many prefetch+LLM+notification chains.
2. The circuit breaker still protects the LLM provider independently.
3. If the circuit breaker is OPEN, the execution fails fast inside the semaphore slot and releases quickly.

### Pattern 3: Shutdown Drain with Timeout

**What:** On signal, stop new work, wait for in-flight, timeout and mark failures.
**When to use:** When process shutdown must not leave orphaned "running" records.
**Example:**
```typescript
// In src/index.ts -- extended shutdown()
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return; // Prevent double shutdown
  shuttingDown = true;

  console.log("Schedoodle shutting down...");
  stopRateLimiterCleanup();
  stopAll(); // Stop scheduler (no new cron triggers)
  server.close(); // Stop accepting new HTTP requests

  // Drop queued (not-yet-started) executions
  const dropped = llmSemaphore.drain();
  if (dropped > 0) {
    console.log(`[shutdown] Dropped ${dropped} queued execution(s)`);
  }

  // Wait for in-flight to complete
  const status = llmSemaphore.getStatus();
  if (status.active > 0) {
    console.log(`[shutdown] Waiting for ${status.active} in-flight executions to complete (30s timeout)...`);

    const deadline = Date.now() + 30_000;
    while (llmSemaphore.getStatus().active > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }

    if (llmSemaphore.getStatus().active > 0) {
      // Timeout: mark remaining running records as failure
      const staleCount = markRunningAsShutdownTimeout(db);
      console.log(`[shutdown] Timeout exceeded, marked ${staleCount} execution(s) as failed`);
    } else {
      console.log("[shutdown] All executions complete, exiting");
    }
  }

  process.exit(0);
}
```

### Pattern 4: Shutdown-Aware Health Endpoint

**What:** Health endpoint returns 503 during shutdown and includes concurrency stats.
**When to use:** When load balancers/clients need to detect a shutting-down instance.
**Example:**
```typescript
// In health route factory -- add shuttingDown callback and semaphore status callback
export function createHealthRoute(
  db: Database,
  getCircuitStatus: () => CircuitBreakerStatus,
  startedAt: number,
  getScheduledJobs: () => Map<number, Cron>,
  getConcurrencyStatus: () => SemaphoreStatus,
  isShuttingDown: () => boolean,
): Hono {
  app.get("/", (c) => {
    if (isShuttingDown()) {
      return c.json({ status: "shutting_down", ... }, 503);
    }
    // ... existing health logic ...
    return c.json({
      status,
      shutting_down: false,
      concurrency: getConcurrencyStatus(),
      // ... rest
    });
  });
}
```

### Anti-Patterns to Avoid
- **Semaphore inside the LLM call only:** Would not protect against N concurrent prefetch operations running simultaneously. The semaphore must wrap the full `executeAgent`.
- **Using setTimeout for drain polling without cleanup:** Always clear the interval/timeout. Use a loop with `await delay()` instead.
- **Calling process.exit() synchronously in signal handler:** The shutdown must be async to wait for drain. Wrap with an async IIFE or use `.then()`.
- **Forgetting double-shutdown guard:** SIGINT and SIGTERM can fire in quick succession. The `shuttingDown` flag prevents re-entry.
- **Tracking active count with a separate counter:** Error-prone if a release is missed. The semaphore's `available` count is the single source of truth.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FIFO async queue | Custom linked list + manual Promise wiring | Simple array of resolve functions + shift() | Array.shift() is O(n) but queue will never exceed agent count (bounded) |
| Shutdown timeout | setTimeout + manual state machine | Poll loop with Date.now() deadline check | Simpler, easier to test, avoids orphaned timers |
| Process signal deduplication | Custom event emitter | Boolean `shuttingDown` flag checked at top of handler | One flag covers SIGINT + SIGTERM dedup |

**Key insight:** All three "don't hand-roll" items are actually simpler than the thing you might build. The semaphore is the most complex piece and it's ~30 lines.

## Common Pitfalls

### Pitfall 1: Semaphore Release Not in finally Block
**What goes wrong:** If `executeAgent` throws before the release, the slot is never freed and the semaphore permanently loses a slot.
**Why it happens:** Release put in the success path only, not the error path.
**How to avoid:** Always use `try { ... } finally { semaphore.release(); }`.
**Warning signs:** Gradually decreasing throughput over time as slots leak.

### Pitfall 2: Async Signal Handler
**What goes wrong:** `process.on('SIGTERM', async () => { ... })` -- the process exits before the async handler completes.
**Why it happens:** Node.js signal handlers are fire-and-forget. The event loop drains after the sync part of the handler returns.
**How to avoid:** The async drain keeps the event loop alive (pending Promises and setTimeout). Avoid calling `process.exit()` until drain is complete. The pattern works because the await in the shutdown function keeps the event loop busy.
**Warning signs:** Process exits immediately after "Shutting down..." log without waiting.

### Pitfall 3: Double Shutdown
**What goes wrong:** SIGINT fires, starts drain, then SIGTERM fires (or user presses Ctrl+C again), causing a second drain attempt which corrupts state.
**Why it happens:** Both signals are registered and can fire independently.
**How to avoid:** Set `shuttingDown = true` at the top of the handler, return early if already set.
**Warning signs:** Duplicate shutdown log messages, race conditions in DB updates.

### Pitfall 4: Semaphore Drain vs Active Confusion
**What goes wrong:** `drain()` drops queued waiters, but the count of "active" executions is wrong because drain also changes the available count.
**Why it happens:** Misunderstanding of what `drain()` should do. Drain should only clear the waiters array. Active executions (those that have acquired a slot) are tracked by `limit - available` and are NOT affected by draining the queue.
**How to avoid:** `drain()` clears `waiters` array only. It does not touch `available`. Active slots are still held by running Promises.
**Warning signs:** `getStatus().active` returns wrong count after drain.

### Pitfall 5: Shutdown Marking Races with Normal Completion
**What goes wrong:** An execution completes normally during shutdown, updating its status to "success", then the shutdown timeout marks it as "failure" (overwriting the success).
**Why it happens:** The shutdown uses a blanket `WHERE status = 'running'` update.
**How to avoid:** This is actually safe because the normal completion updates the status away from 'running' before the shutdown timeout fires. The `WHERE status = 'running'` filter only catches truly stuck records.
**Warning signs:** None if implemented correctly -- the WHERE clause handles it.

### Pitfall 6: Health Route 503 Prevents Monitoring
**What goes wrong:** Monitoring tools see 503 and alert during every graceful restart.
**Why it happens:** The health endpoint returns 503 during shutdown for load balancer deregistration.
**How to avoid:** This is intentional behavior. The body includes `shutting_down: true` so monitoring can distinguish planned shutdown from real unavailability.
**Warning signs:** False positive alerts (operational concern, not a code bug).

## Code Examples

### Env Config Addition
```typescript
// In src/config/env.ts -- add to the schema object
MAX_CONCURRENT_LLM: z.coerce.number().min(1).default(3),
```

### Marking Running Records on Shutdown Timeout
```typescript
// Reuses same pattern as startup.ts cleanupStaleExecutions
// but with a different error message
function markRunningAsShutdownTimeout(db: Database): number {
  const now = new Date().toISOString();
  const result = db
    .update(executionHistory)
    .set({
      status: "failure",
      error: "Shutdown timeout exceeded",
      completedAt: now,
    })
    .where(eq(executionHistory.status, "running"))
    .run();
  return result.changes;
}
```

### Shutdown Guard for Manual Execute Endpoint
```typescript
// In agents.ts POST /:id/execute handler
// Check if shutting down before accepting work
if (isShuttingDown()) {
  return c.json({ error: "Service is shutting down" }, 503);
}
```

### Semaphore Singleton Pattern (matches circuit breaker)
```typescript
// Module-level singleton with reset for testing
let llmSemaphore = createSemaphore(env.MAX_CONCURRENT_LLM);

export function getLlmSemaphoreStatus(): SemaphoreStatus {
  return llmSemaphore.getStatus();
}

export function drainLlmSemaphore(): number {
  return llmSemaphore.drain();
}

export function _resetLlmSemaphore(): void {
  llmSemaphore = createSemaphore(env.MAX_CONCURRENT_LLM);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Unbounded Promise.allSettled | Semaphore-gated execution | This phase | Prevents LLM API overload |
| Immediate process.exit on signal | Drain + timeout + cleanup | This phase | No orphaned "running" records |
| Health endpoint lacks concurrency info | Concurrency section in health | This phase | Better operational visibility |

**Deprecated/outdated:**
- Nothing deprecated -- this phase extends existing patterns.

## Open Questions

1. **Should the `shutting_down` state be a module-level variable in index.ts or a shared module?**
   - What we know: Health route needs to read it, manual execute endpoint needs to read it, shutdown handler sets it.
   - What's unclear: Whether to pass as a callback (like `getCircuitStatus`) or use a shared module.
   - Recommendation: Use callbacks passed to route factories (consistent with existing `getCircuitStatus` pattern). Export `isShuttingDown()` from index.ts or a shared state module.

2. **Should the semaphore live in executor.ts or a separate module?**
   - What we know: Circuit breaker is in its own module (`circuit-breaker.ts`). The semaphore is a similarly reusable primitive.
   - What's unclear: Whether the semaphore wrapping belongs in executor.ts or if executor.ts should remain unaware.
   - Recommendation: Create `src/services/semaphore.ts` for the semaphore primitive. The semaphore singleton and wrapping logic lives in executor.ts (where the singleton circuit breaker already lives). Export `getLlmSemaphoreStatus()` and `drainLlmSemaphore()` from executor.ts.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/semaphore.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONC-01 | Semaphore limits to N concurrent | unit | `npx vitest run tests/semaphore.test.ts -x` | No -- Wave 0 |
| CONC-02 | executeAgent wrapped with semaphore | unit | `npx vitest run tests/executor.test.ts -x` | Yes (extend) |
| CONC-03 | FIFO queue order when slots full | unit | `npx vitest run tests/semaphore.test.ts -x` | No -- Wave 0 |
| SHUT-01 | Shutdown waits for in-flight, times out | unit | `npx vitest run tests/shutdown.test.ts -x` | No -- Wave 0 |
| SHUT-02 | Timeout marks running records as failure | unit | `npx vitest run tests/shutdown.test.ts -x` | No -- Wave 0 |
| SHUT-03 | Drain drops queued, keeps in-flight | unit | `npx vitest run tests/semaphore.test.ts -x` | No -- Wave 0 |
| OBSV-01 | Health includes concurrency stats | unit | `npx vitest run tests/health.test.ts -x` | Yes (extend) |
| OBSV-02 | Health returns 503 during shutdown | unit | `npx vitest run tests/health.test.ts -x` | Yes (extend) |
| OBSV-03 | Conditional log when queued | unit | `npx vitest run tests/executor.test.ts -x` | Yes (extend) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/semaphore.test.ts tests/executor.test.ts tests/health.test.ts -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/semaphore.test.ts` -- covers CONC-01, CONC-03, SHUT-03
- [ ] `tests/shutdown.test.ts` -- covers SHUT-01, SHUT-02 (or extend startup.test.ts)

## Sources

### Primary (HIGH confidence)
- Project codebase: `src/services/circuit-breaker.ts` -- establishes singleton pattern (~85 lines)
- Project codebase: `src/services/executor.ts` -- executeAgent is the wrapping target
- Project codebase: `src/index.ts` -- existing shutdown() handler to extend
- Project codebase: `src/routes/health.ts` -- health response structure to extend
- Project codebase: `src/config/env.ts` -- Zod env schema pattern

### Secondary (MEDIUM confidence)
- [Understanding Semaphores: A TypeScript Guide (dev.to)](https://dev.to/thegravityguy/understanding-semaphores-a-typescript-guide-2blb) -- CountingSemaphore implementation verified
- [Parallelizing Work via a JavaScript Semaphore (alexn.org)](https://alexn.org/blog/2020/04/21/javascript-semaphore/) -- AsyncSemaphore with active count tracking
- [Vercel async-sema (GitHub)](https://github.com/vercel/async-sema) -- Production-grade semaphore reference
- [Hono node-server close issue (GitHub)](https://github.com/honojs/hono/issues/3104) -- server.close() behavior confirmed
- [How to Build a Graceful Shutdown Handler in Node.js (oneuptime.com)](https://oneuptime.com/blog/post/2026-01-06-nodejs-graceful-shutdown-handler/view) -- Shutdown pattern

### Tertiary (LOW confidence)
- None -- all findings verified with multiple sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, extends existing patterns
- Architecture: HIGH -- semaphore is a well-understood primitive, integration points are clear from codebase
- Pitfalls: HIGH -- common concurrency pitfalls are well-documented; signal handling edge cases verified
- Shutdown drain: HIGH -- pattern confirmed across multiple Node.js shutdown guides

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable patterns, no version-sensitive concerns)
