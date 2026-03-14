---
phase: 04-resilience-and-observability
plan: 01
subsystem: services
tags: [circuit-breaker, pricing, cost-tracking, resilience, observability]

# Dependency graph
requires:
  - phase: 02-execution-engine
    provides: executor service with callLlmWithRetry and execution history recording
provides:
  - Circuit breaker state machine (CLOSED/OPEN/HALF_OPEN) for LLM calls
  - Model pricing lookup and per-execution cost estimation
  - getLlmCircuitStatus() for health endpoint consumption
  - estimatedCost column on execution_history table
affects: [04-02-health-endpoint, 05-delivery]

# Tech tracking
tech-stack:
  added: []
  patterns: [circuit-breaker-state-machine, model-pricing-lookup, cost-per-execution]

key-files:
  created:
    - src/services/circuit-breaker.ts
    - src/config/pricing.ts
    - tests/circuit-breaker.test.ts
    - tests/pricing.test.ts
  modified:
    - src/db/schema.ts
    - src/services/executor.ts
    - tests/executor.test.ts
    - tests/db.test.ts
    - tests/routes-agents.test.ts
    - tests/scheduler.test.ts

key-decisions:
  - "Separate openedAt timestamp from lastFailureTime for correct HALF_OPEN re-open cooldown behavior"
  - "Module-level circuit breaker singleton with _resetLlmBreaker() export for test isolation"
  - "Custom circuit breaker implementation (no external library) for zero-dependency simplicity"

patterns-established:
  - "Circuit breaker factory: createCircuitBreaker(options) returning { execute, getStatus }"
  - "Model pricing as static lookup table with fallback to Sonnet 4 rates"

requirements-completed: [RSLN-01, RSLN-02, OBSV-01]

# Metrics
duration: 6min
completed: 2026-03-14
---

# Phase 4 Plan 1: Circuit Breaker and Cost Tracking Summary

**Circuit breaker state machine protecting LLM calls (trips after 3 failures, 30s cooldown, auto-recovery) with per-execution USD cost tracking from model-specific pricing table**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-14T19:41:31Z
- **Completed:** 2026-03-14T19:47:42Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Circuit breaker with CLOSED/OPEN/HALF_OPEN state machine prevents hammering downed Anthropic API
- Model pricing table for Sonnet 4, Sonnet 4.5, Haiku 4.5, Opus 4.5 with fallback to Sonnet 4 rates
- estimatedCost column on execution_history records USD cost per execution
- getLlmCircuitStatus() exported for health endpoint consumption in Plan 02
- Full TDD coverage: 20 circuit breaker/pricing tests + 3 new executor tests (96 total passing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Circuit breaker service and pricing config (TDD RED)** - `94c0c3c` (test)
2. **Task 1: Circuit breaker service and pricing config (TDD GREEN)** - `262ccc7` (feat)
3. **Task 2: Integrate circuit breaker and cost tracking into executor** - `ce8c873` (feat)

_Note: Task 1 followed TDD with separate RED and GREEN commits_

## Files Created/Modified
- `src/services/circuit-breaker.ts` - Circuit breaker state machine with CLOSED/OPEN/HALF_OPEN transitions
- `src/config/pricing.ts` - Model pricing lookup and estimateCost function
- `src/db/schema.ts` - Added estimatedCost real column to executionHistory
- `src/services/executor.ts` - Integrated circuit breaker wrapping LLM calls, cost tracking on success
- `tests/circuit-breaker.test.ts` - 11 tests for circuit breaker state machine
- `tests/pricing.test.ts` - 9 tests for pricing lookup and cost estimation
- `tests/executor.test.ts` - 3 new tests for cost recording and circuit breaker integration
- `tests/db.test.ts` - Updated SQL for estimatedCost column
- `tests/routes-agents.test.ts` - Updated SQL for estimatedCost column
- `tests/scheduler.test.ts` - Updated SQL for estimatedCost column

## Decisions Made
- Used separate `openedAt` timestamp (distinct from `lastFailureTime`) so the OPEN->HALF_OPEN cooldown timer restarts correctly on probe failure without losing the original failure time
- Created module-level circuit breaker singleton in executor.ts with `_resetLlmBreaker()` for test isolation between test cases
- Implemented custom circuit breaker rather than using an external library -- zero dependencies, ~85 lines, purpose-built for the single LLM provider use case

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated test SQL in db.test.ts, routes-agents.test.ts, scheduler.test.ts**
- **Found during:** Task 2 (Integration)
- **Issue:** Adding estimatedCost column to schema broke 7 tests in other test files that create in-memory SQLite tables without the new column
- **Fix:** Added `estimated_cost REAL` to CREATE_EXECUTION_HISTORY_SQL in all 3 affected test files
- **Files modified:** tests/db.test.ts, tests/routes-agents.test.ts, tests/scheduler.test.ts
- **Verification:** All 96 tests pass
- **Committed in:** ce8c873 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary fix for schema change propagation to test infrastructure. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Circuit breaker status available via `getLlmCircuitStatus()` for health endpoint in Plan 02
- estimatedCost column ready for dashboard/observability queries
- All existing functionality preserved (96 tests green)

---
*Phase: 04-resilience-and-observability*
*Completed: 2026-03-14*
