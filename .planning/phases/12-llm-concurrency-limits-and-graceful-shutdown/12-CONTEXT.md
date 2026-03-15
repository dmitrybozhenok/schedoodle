# Phase 12: LLM Concurrency Limits and Graceful Shutdown - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Control how many LLM calls run simultaneously via a global concurrency limiter, and ensure in-flight executions complete cleanly on shutdown with a timeout-based drain. No new agent features, no new endpoints (extends existing health), no scheduling changes.

</domain>

<decisions>
## Implementation Decisions

### Concurrency limiting
- Global limit of 3 concurrent LLM calls (MAX_CONCURRENT_LLM env var, default 3)
- Custom semaphore implementation (~30 lines, no external dependencies) — matches project's custom circuit breaker pattern
- Shared pool for both scheduled cron executions and manual POST /agents/:id/execute
- Semaphore wraps the executeAgent call — acquire before execution, release after

### Graceful shutdown
- On SIGINT/SIGTERM: stop accepting new executions, wait up to 30 seconds for in-flight calls to finish
- Log on shutdown: '[shutdown] Waiting for N in-flight executions to complete (30s timeout)...'
- On all complete: '[shutdown] All executions complete, exiting'
- On timeout: mark remaining 'running' records as 'failure' with error 'Shutdown timeout exceeded', then force exit
- Don't rely on next startup's stale cleanup — mark records inline before exiting

### Queue/backpressure
- When all slots are full, new executions wait in a FIFO queue (semaphore's acquire() blocks naturally)
- Manual execute (POST /agents/:id/execute) transparently waits — HTTP request takes longer, no 202/polling
- On shutdown, drop queued (not-yet-started) executions — only wait for in-flight calls
- Dropped scheduled executions will trigger again on next cron cycle after restart

### Observability
- Add 'concurrency' section to GET /health: { active: N, queued: N, limit: N }
- Log only when an execution has to wait: '[concurrency] Slot full (3/3 active), agent "X" queued'
- Don't log normal acquire/release — too noisy (matches Phase 11's conditional logging pattern)
- Add 'shutting_down: true/false' to health response; return 503 when shutting down
- Full concurrency is normal operation — don't degrade top-level health status for saturated slots

### Claude's Discretion
- Exact semaphore implementation details (Promise-based acquire/release pattern)
- How to track active execution count for the shutdown drain (counter vs Set of promises)
- Where the semaphore singleton lives (new module vs extend executor.ts)
- Integration order of concurrency wrapping with circuit breaker

</decisions>

<specifics>
## Specific Ideas

- The semaphore should be a simple acquire/release pattern similar to the custom circuit breaker — project prefers zero-dependency solutions
- Shutdown drain should interact cleanly with Phase 11's startup cleanup — if shutdown marks records inline, startup cleanup only catches truly unexpected crashes

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/executor.ts`: executeAgent() is the single point where LLM calls happen — semaphore wraps here
- `src/services/executor.ts`: executeAgents() uses Promise.allSettled — may need semaphore integration
- `src/services/circuit-breaker.ts`: Custom circuit breaker pattern (~85 lines) — semaphore follows same style
- `src/index.ts`: shutdown() function already handles SIGINT/SIGTERM — extend with drain logic
- `src/routes/health.ts`: Health endpoint already returns circuit breaker status and agent health — add concurrency section
- `src/config/env.ts`: Zod env config with coerce + default pattern — add MAX_CONCURRENT_LLM here

### Established Patterns
- Module-level singletons with reset functions for testing (circuit breaker pattern)
- Factory functions for routes with dependency injection
- Conditional console.log for operational messages (Phase 11 startup pattern)
- Synchronous DB operations via better-sqlite3

### Integration Points
- `src/services/semaphore.ts` (new): Custom semaphore module
- `src/services/executor.ts`: Wrap executeAgent with semaphore acquire/release
- `src/index.ts`: Shutdown function extended with drain + timeout + stale record marking
- `src/routes/health.ts`: Add concurrency stats + shutting_down flag
- `src/config/env.ts`: MAX_CONCURRENT_LLM env var

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 12-llm-concurrency-limits-and-graceful-shutdown*
*Context gathered: 2026-03-15*
