# Phase 17: Code Refactoring, Cleanup - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Internal code quality improvements: decompose oversized modules, eliminate duplication, centralize configuration constants, and introduce a lightweight logger utility. No new features, no API changes, no external behavior changes.

</domain>

<decisions>
## Implementation Decisions

### Executor decomposition
- Full decomposition of executor.ts (382 lines) into focused modules:
  - ExecutionOrchestrator — coordinates the execution flow (semaphore, timeout, abort)
  - ExecutionRecorder — persists execution results to DB (insert running, update success/failure)
  - Notification dispatch logic moves into notifier.ts (eliminates ~100 lines of duplication between success/failure paths)
- The existing executeAgent / executeAgentInner entry points should be preserved as the public API

### Shared utilities extraction
- Extract all duplicated route utilities into `src/helpers/validation.ts`:
  - `zodErrorHook` (currently duplicated in agents.ts, schedules.ts, tools.ts)
  - `parseId` helper
  - Any other repeated route patterns discovered during implementation
- Route files should import from the shared module instead of defining locally

### Logger utility
- Create a lightweight logger wrapper (no new dependencies) in a new file
- Standardize the existing [cron], [startup], [shutdown], [notify], [concurrency] prefixes
- Expose log levels (info, warn, error) for consistency
- Still console-based — easy to swap for Pino later if needed
- Replace all 32 console.log/error/warn calls across src/

### Configuration centralization
- Move all hardcoded operational constants to `src/config/constants.ts`
- Constants to centralize:
  - Rate limiter: LLM_MAX_REQUESTS (10), GENERAL_MAX_REQUESTS (60), WINDOW_MS (60000)
  - Circuit breaker: FAILURE_THRESHOLD (3), RESET_TIMEOUT_MS (30000)
  - Prefetch: FETCH_TIMEOUT_MS (10000), MAX_RESPONSE_BYTES (1048576)
  - Executor: DEFAULT_EXECUTION_TIMEOUT_MS (60000)
  - Semaphore: default from MAX_CONCURRENT_LLM env var
- NOT env-configurable — just a single source of truth file. Values stay the same.

### API compatibility
- All REST API response shapes, status codes, and error formats stay IDENTICAL
- This is strictly internal refactoring — no downstream breakage
- Health endpoint response shape unchanged
- MCP server stays independent — don't refactor MCP in this phase

### Code organization
- Keep services/ directory flat (no sub-directories) — 10 files is manageable
- Keep manage.ts and dashboard.ts with inline HTML — intentional design, not worth extracting
- New files from decomposition stay in services/ alongside existing files

### Claude's Discretion
- Exact naming of decomposed executor modules
- Whether to keep circuit-breaker and semaphore imports in the orchestrator or pass them as dependencies
- How to structure the logger API (function-based vs object-based)
- Whether parseId warrants inclusion in helpers/validation.ts or stays inline

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core refactoring targets
- `src/services/executor.ts` — Primary decomposition target (382 lines, 7+ responsibilities)
- `src/services/notifier.ts` — Receives notification dispatch logic from executor
- `src/routes/agents.ts` — Contains zodErrorHook to extract (380 lines)
- `src/routes/schedules.ts` — Contains zodErrorHook duplicate
- `src/routes/tools.ts` — Contains zodErrorHook duplicate

### Configuration targets
- `src/middleware/rate-limiter.ts` — Hardcoded LLM_MAX_REQUESTS, GENERAL_MAX_REQUESTS
- `src/services/circuit-breaker.ts` — Hardcoded failureThreshold, resetTimeoutMs
- `src/services/prefetch.ts` — Hardcoded timeout (10000), MAX_RESPONSE_BYTES

### Test files that will need restructuring
- `tests/executor.test.ts` — 1,214 lines, must split to match decomposed modules
- `tests/notifier.test.ts` — 490 lines, may need updates for moved notification dispatch

### Existing patterns to follow
- `src/helpers/enrich-agent.ts` — Example of existing helper module pattern
- `src/helpers/cron-detect.ts` — Example of focused utility module

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/helpers/` directory already exists with enrich-agent.ts and cron-detect.ts — validation.ts fits naturally here
- `src/config/env.ts` provides the pattern for centralized configuration (Zod-validated env vars)
- `src/config/pricing.ts` provides the pattern for a constants file (static lookup table)

### Established Patterns
- Factory functions for routes: `createAgentRoutes(db, isShuttingDown)` — decomposed modules should follow similar DI patterns
- Module-level singletons with `_reset*()` test helpers: circuit-breaker and semaphore both use this pattern
- Fire-and-forget notification: `Promise.allSettled()` for parallel dispatch — preserve this pattern when moving to notifier.ts

### Integration Points
- executor.ts exports `executeAgent`, `executeAgentInner`, `_resetLlmBreaker`, `_resetLlmSemaphore`, `getLlmCircuitStatus`, `getLlmSemaphoreStatus` — all must remain importable from the same or predictable paths
- routes/agents.ts imports from executor — import paths must stay valid or update cleanly
- health.ts imports circuit/semaphore status getters — must remain accessible
- MCP tools/agents.ts imports executeAgent — import path must not break

</code_context>

<specifics>
## Specific Ideas

- Executor decomposition should preserve the existing public API (executeAgent, executeAgentInner) so callers don't change
- Logger should use the same [prefix] format already established — just standardize it
- Test verification: run full test suite after EVERY refactoring step (green suite required before proceeding)
- Test files split to match new module boundaries (executor.test.ts splits into orchestrator, recorder, notification tests)

</specifics>

<deferred>
## Deferred Ideas

- Structured JSON logging with Pino — future phase if production deployment needed
- MCP server refactoring / shared service layer — separate concern
- Pagination on list endpoints — feature addition, not refactoring
- N+1 query optimization in health endpoint — performance phase
- Per-model circuit breaker (currently per-provider) — resilience enhancement

</deferred>

---

*Phase: 17-code-refactoring-cleanup*
*Context gathered: 2026-03-16*
