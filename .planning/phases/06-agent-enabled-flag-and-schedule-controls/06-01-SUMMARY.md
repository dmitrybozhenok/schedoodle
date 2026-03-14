---
phase: 06-agent-enabled-flag-and-schedule-controls
plan: 01
subsystem: api
tags: [sqlite, drizzle, croner, zod, scheduler, enabled-flag]

# Dependency graph
requires:
  - phase: 03-management-api
    provides: scheduler service with scheduleAgent/removeAgent/startAll
  - phase: 01-foundation
    provides: agents table schema, Zod input validation, type definitions
provides:
  - enabled integer column on agents table (default 1)
  - enrichAgent helper with nextRunAt, lastRunAt, boolean enabled conversion
  - AgentResponse type for API responses
  - Scheduler startAll filters by enabled flag with disabled count logging
  - Updated test SQL across all test files
affects: [06-02-api-routes]

# Tech tracking
tech-stack:
  added: []
  patterns: [enrichAgent helper for DB-to-API response conversion, croner paused instance for nextRun computation]

key-files:
  created: [src/helpers/enrich-agent.ts, tests/helpers-enrich-agent.test.ts]
  modified: [src/db/schema.ts, src/schemas/agent-input.ts, src/types/index.ts, src/services/scheduler.ts, tests/scheduler.test.ts, tests/routes-agents.test.ts, tests/db.test.ts, tests/executor.test.ts, tests/health.test.ts]

key-decisions:
  - "enrichAgent uses separate query per agent for lastRunAt (simple, bounded agent counts)"
  - "getNextRunAt creates paused Cron instance and stops it to avoid memory leaks"
  - "Boolean() conversion for enabled field in enrichAgent (integer 0/1 to boolean)"

patterns-established:
  - "enrichAgent helper: single function for DB row to API response enrichment"
  - "Paused Cron pattern: new Cron(expr, { paused: true }) + nextRun() + stop()"

requirements-completed: [AGNT-05]

# Metrics
duration: 4min
completed: 2026-03-14
---

# Phase 6 Plan 01: Schema, Scheduler, and enrichAgent Summary

**Enabled flag on agents table with scheduler filtering and enrichAgent helper for computed nextRunAt/lastRunAt fields**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-14T23:22:33Z
- **Completed:** 2026-03-14T23:27:00Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Added enabled integer column to agents table with default 1 (all existing agents stay enabled)
- Created enrichAgent helper that converts DB rows to API responses with boolean enabled, nextRunAt (from croner), and lastRunAt (from execution_history)
- Scheduler startAll now filters by enabled flag and logs disabled count
- All 167 tests pass across 13 test files with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema, input schemas, and enrichAgent helper**
   - `87f40e4` (test) - failing tests for enrichAgent and schema enabled field
   - `f2a5764` (feat) - enabled column, AgentResponse type, enrichAgent helper

2. **Task 2: Scheduler enable/disable logic and test SQL updates**
   - `3ec9454` (test) - failing scheduler enabled/disabled tests, updated test SQL
   - `216d1e6` (feat) - scheduler startAll filters by enabled, fixed all test SQL

## Files Created/Modified
- `src/db/schema.ts` - Added enabled integer column (default 1) to agents table
- `src/schemas/agent-input.ts` - Added optional boolean enabled field to createAgentSchema
- `src/types/index.ts` - Added AgentResponse type with boolean enabled, nextRunAt, lastRunAt
- `src/helpers/enrich-agent.ts` - New enrichAgent, getNextRunAt, getLastRunAt helpers
- `src/services/scheduler.ts` - startAll filters by enabled, logs disabled count
- `tests/helpers-enrich-agent.test.ts` - 13 tests for enrichAgent helper
- `tests/scheduler.test.ts` - 4 new enabled/disabled behavior tests, updated SQL
- `tests/routes-agents.test.ts` - Updated CREATE_AGENTS_SQL with enabled column
- `tests/db.test.ts` - Updated CREATE_AGENTS_SQL with enabled column
- `tests/executor.test.ts` - Updated CREATE_AGENTS_SQL with enabled column
- `tests/health.test.ts` - Updated CREATE_AGENTS_SQL with enabled column

## Decisions Made
- Used separate query per agent for lastRunAt (simple approach, bounded by agent count)
- getNextRunAt creates a paused Cron instance and stops it immediately to avoid memory leaks
- Boolean() conversion for enabled field in enrichAgent (consistent integer 0/1 to boolean mapping)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated CREATE_AGENTS_SQL in db, executor, and health test files**
- **Found during:** Task 2 (full test suite verification)
- **Issue:** Three test files (db.test.ts, executor.test.ts, health.test.ts) had CREATE_AGENTS_SQL without the enabled column, causing 30 test failures
- **Fix:** Added `enabled INTEGER NOT NULL DEFAULT 1` to CREATE_AGENTS_SQL in all three files
- **Files modified:** tests/db.test.ts, tests/executor.test.ts, tests/health.test.ts
- **Verification:** Full test suite (167 tests) passes
- **Committed in:** 216d1e6 (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix -- plan only mentioned updating scheduler and routes test SQL, but the schema change affected all test files. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema and helpers ready for Plan 02 (API routes)
- enrichAgent can be imported directly in route handlers
- Scheduler already filters by enabled -- Plan 02 needs to add PATCH enable/disable toggle and GET filtering

## Self-Check: PASSED

All 7 key files verified present. All 4 commits (87f40e4, f2a5764, 3ec9454, 216d1e6) verified in git log.

---
*Phase: 06-agent-enabled-flag-and-schedule-controls*
*Completed: 2026-03-14*
