---
phase: 11-data-integrity-and-execution-lifecycle
plan: 01
subsystem: database
tags: [sqlite, drizzle-orm, indexes, startup, retention, env-config]

requires:
  - phase: 01-foundation
    provides: Database schema with executionHistory table, env config with Zod
provides:
  - execution_history indexes for query performance (agent_id, agent_id+started_at, status)
  - RETENTION_DAYS env var with default 30 and min 1 validation
  - Startup module with stale execution cleanup and history pruning
  - Boot sequence ordering (cleanup -> pruning -> scheduler start)
affects: [12-llm-concurrency-limits-and-graceful-shutdown]

tech-stack:
  added: []
  patterns: [startup-task-module, conditional-logging, age-based-pruning]

key-files:
  created:
    - src/services/startup.ts
    - tests/startup.test.ts
  modified:
    - src/db/schema.ts
    - src/config/env.ts
    - src/index.ts
    - tests/db.test.ts
    - tests/config.test.ts

key-decisions:
  - "Conditional logging (count > 0) for clean startup output when nothing to clean"
  - "Startup tasks as pure synchronous functions taking db parameter for testability"
  - "db:push applied indexes cleanly without table recreation"

patterns-established:
  - "Startup task module: pure functions in src/services/startup.ts taking db parameter"
  - "Boot sequence ordering: data cleanup before scheduler start"
  - "Optional numeric env var: z.coerce.number().min(N).default(D) pattern"

requirements-completed: [INDEX-01, ENV-01, STARTUP-01, STARTUP-02]

duration: 3min
completed: 2026-03-15
---

# Phase 11 Plan 01: Schema Indexes, Env Config, and Startup Tasks Summary

**Execution history indexes for query performance, RETENTION_DAYS env var with default 30, and startup module that cleans stale running executions and prunes old history before scheduler starts**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-15T04:15:16Z
- **Completed:** 2026-03-15T04:18:16Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Three indexes on execution_history table (agent_id, agent_id+started_at, status) for query performance
- RETENTION_DAYS optional env var with coerce, min(1), default(30) for configurable history retention
- Startup module with cleanupStaleExecutions and pruneOldExecutions functions
- Boot sequence wiring: stale cleanup -> pruning -> scheduler start in src/index.ts
- Comprehensive TDD tests: 5 startup tests, 3 index tests, 4 RETENTION_DAYS tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema indexes, RETENTION_DAYS env, and tests**
   - `63cd591` (test: RED - failing tests for indexes and RETENTION_DAYS)
   - `e976b8c` (feat: GREEN - indexes and RETENTION_DAYS implementation)
2. **Task 2: Startup module and boot sequence wiring**
   - `9f9b92a` (test: RED - failing tests for startup cleanup and pruning)
   - `052a65a` (feat: GREEN - startup module and boot sequence)

_TDD tasks have two commits each (RED test -> GREEN implementation)_

## Files Created/Modified
- `src/services/startup.ts` - New startup module: cleanupStaleExecutions and pruneOldExecutions
- `src/db/schema.ts` - Added index() import and three index declarations on executionHistory
- `src/config/env.ts` - Added RETENTION_DAYS with z.coerce.number().min(1).default(30)
- `src/index.ts` - Boot sequence: startup imports and calls before scheduler start
- `tests/startup.test.ts` - 5 tests for stale cleanup and history pruning
- `tests/db.test.ts` - 3 index existence tests plus CREATE INDEX in setup SQL
- `tests/config.test.ts` - 4 RETENTION_DAYS validation tests

## Decisions Made
- Conditional logging (only when count > 0) instead of unconditional -- keeps startup output clean when there is nothing to clean up
- Pure synchronous functions taking db as parameter for easy testability with in-memory SQLite
- db:push applied indexes cleanly (CREATE INDEX, no table recreation needed)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - RETENTION_DAYS is optional with a sensible default of 30 days. No external service configuration required.

## Next Phase Readiness
- Startup module ready for any additional boot-time tasks
- Schema indexes applied to dev database via db:push
- Full test suite passes (383 tests across 26 files)

## Self-Check: PASSED

All 7 files verified present. All 4 commits verified in git log. Must-have artifacts confirmed: 3 index declarations in schema.ts, RETENTION_DAYS in env.ts, cleanupStaleExecutions and pruneOldExecutions exported from startup.ts, boot sequence wired in index.ts.

---
*Phase: 11-data-integrity-and-execution-lifecycle*
*Completed: 2026-03-15*
