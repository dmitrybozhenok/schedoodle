---
phase: 12-llm-concurrency-limits-and-graceful-shutdown
plan: 01
subsystem: execution
tags: [semaphore, concurrency, rate-limiting, env-config]

# Dependency graph
requires:
  - phase: 04-resilience-and-observability
    provides: circuit breaker pattern (singleton + reset), executor structure
  - phase: 11-data-integrity-and-execution-lifecycle
    provides: conditional logging pattern, startup cleanup
provides:
  - Counting semaphore primitive (createSemaphore) with FIFO queue
  - MAX_CONCURRENT_LLM env config (default 3, min 1)
  - Semaphore-wrapped executeAgent with acquire/release in try/finally
  - Concurrency status/drain/reset exports for shutdown and health consumption
affects: [12-02 graceful shutdown, health endpoint concurrency section]

# Tech tracking
tech-stack:
  added: []
  patterns: [counting semaphore with FIFO queue, module-level singleton with reset]

key-files:
  created:
    - src/services/semaphore.ts
    - tests/semaphore.test.ts
  modified:
    - src/config/env.ts
    - src/services/executor.ts
    - tests/executor.test.ts
    - tests/setup.ts
    - tests/config.test.ts

key-decisions:
  - "Semaphore as separate module (~45 lines) matching circuit-breaker.ts pattern"
  - "Rename executeAgent to executeAgentInner, new executeAgent wraps with semaphore"
  - "Conditional concurrency log only when slots are full (matches Phase 11 pattern)"

patterns-established:
  - "Semaphore wrapping pattern: acquire before, release in finally block"
  - "Module-level semaphore singleton with _resetLlmSemaphore for test isolation"

requirements-completed: [CONC-01, CONC-02, CONC-03, OBSV-03]

# Metrics
duration: 10min
completed: 2026-03-15
---

# Phase 12 Plan 01: LLM Concurrency Limiter Summary

**Counting semaphore with FIFO queue limiting concurrent LLM calls to MAX_CONCURRENT_LLM (default 3), integrated into executeAgent with conditional queuing log**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-15T04:53:09Z
- **Completed:** 2026-03-15T05:03:22Z
- **Tasks:** 2 (TDD: RED-GREEN for each)
- **Files modified:** 7

## Accomplishments
- Created a zero-dependency counting semaphore with FIFO queue, drain, status, and reset
- Added MAX_CONCURRENT_LLM env var (default 3, min 1) with Zod coercion
- Wrapped executeAgent with semaphore acquire/release in try/finally for guaranteed slot release
- Conditional logging when execution is queued: "[concurrency] Slot full (N/N active), agent X queued"
- Exported getLlmSemaphoreStatus, drainLlmSemaphore, _resetLlmSemaphore for Plan 02 consumption

## Task Commits

Each task was committed atomically:

1. **Task 1: Create semaphore module and add MAX_CONCURRENT_LLM env config**
   - `70878ff` (test: failing semaphore tests - RED)
   - `632b9eb` (feat: semaphore module + env config - GREEN)
2. **Task 2: Wrap executeAgent with semaphore and add concurrency exports**
   - `f5d9137` (test: failing executor semaphore tests - RED)
   - `7666fa4` (feat: semaphore-wrapped executor - GREEN)

_TDD tasks with RED-GREEN commit pairs._

## Files Created/Modified
- `src/services/semaphore.ts` - Counting semaphore with acquire/release/getStatus/drain/_reset
- `src/config/env.ts` - Added MAX_CONCURRENT_LLM with z.coerce.number().min(1).default(3)
- `src/services/executor.ts` - Semaphore wrapping, renamed inner function, 3 new exports
- `tests/semaphore.test.ts` - 8 unit tests for semaphore primitive
- `tests/executor.test.ts` - 7 integration tests for concurrency wrapping + sendFailureNotification mock
- `tests/setup.ts` - Added MAX_CONCURRENT_LLM env var for test module loading
- `tests/config.test.ts` - 4 tests for MAX_CONCURRENT_LLM validation

## Decisions Made
- Semaphore implemented as separate module (~45 lines) following circuit-breaker.ts pattern of factory function returning methods
- Renamed existing executeAgent to executeAgentInner (non-exported), new executeAgent wraps with semaphore
- Conditional concurrency log only emitted when all slots are full (matching Phase 11's conditional logging pattern)
- Added sendFailureNotification mock to executor tests for complete test isolation (previously missing)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added missing sendFailureNotification mock in executor tests**
- **Found during:** Task 2 (executor test integration)
- **Issue:** notifier.js mock only exported sendNotification, not sendFailureNotification, causing unhandled rejection when failure paths ran
- **Fix:** Added mockSendFailureNotification to vi.mock and all beforeEach blocks
- **Files modified:** tests/executor.test.ts
- **Verification:** All 410 tests pass with no unhandled rejections
- **Committed in:** 7666fa4 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Essential for test reliability. No scope creep.

## Issues Encountered
- Semaphore integration tests with never-resolving mocks caused dangling promises and DB-closed errors when run in sequence. Simplified drain/reset tests to use direct export calls rather than full executeAgent lifecycle, avoiding cross-test state leakage.

## User Setup Required

None - no external service configuration required. MAX_CONCURRENT_LLM defaults to 3 if not set.

## Next Phase Readiness
- Semaphore status exports ready for Plan 02's health endpoint integration
- drainLlmSemaphore ready for Plan 02's graceful shutdown logic
- All 410 tests passing

## Self-Check: PASSED

All 7 key files verified present. All 4 task commits verified in git log.

---
*Phase: 12-llm-concurrency-limits-and-graceful-shutdown*
*Completed: 2026-03-15*
