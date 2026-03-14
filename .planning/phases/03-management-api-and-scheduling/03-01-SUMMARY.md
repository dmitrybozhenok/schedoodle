---
phase: 03-management-api-and-scheduling
plan: 01
subsystem: api, scheduling
tags: [hono, croner, cron, zod, sqlite, scheduling]

# Dependency graph
requires:
  - phase: 02-execution-engine
    provides: executeAgent function, Database type, Agent type
provides:
  - Zod input schemas (createAgentSchema, updateAgentSchema) with cron validation
  - Scheduler service (scheduleAgent, removeAgent, startAll, stopAll)
  - PORT env config
  - Nullable FK on executionHistory.agentId with ON DELETE SET NULL
affects: [03-management-api-and-scheduling]

# Tech tracking
tech-stack:
  added: [hono, "@hono/node-server", "@hono/zod-validator", croner]
  patterns: [cron-job-registry, stale-data-avoidance, zod-refine-validation]

key-files:
  created:
    - src/schemas/agent-input.ts
    - src/services/scheduler.ts
    - tests/scheduler.test.ts
  modified:
    - package.json
    - src/config/env.ts
    - src/db/schema.ts
    - src/db/index.ts

key-decisions:
  - "Used croner Cron constructor with paused:true for cron expression validation in Zod refine"
  - "Map-based job registry keyed by agent ID for O(1) lookup/replace"
  - "Scheduler re-reads agent from DB on each cron trigger to avoid stale closures"

patterns-established:
  - "Cron validation: new Cron(val, { paused: true }) in try/catch for Zod refine"
  - "Job registry: Map<number, Cron> with stop-before-replace pattern"
  - "Stale data avoidance: re-read entity from DB in cron callback, skip if deleted"

requirements-completed: [SCHD-01, SCHD-02]

# Metrics
duration: 3min
completed: 2026-03-14
---

# Phase 3 Plan 1: Deps, Schemas, and Scheduler Summary

**Hono/croner deps installed, Zod input schemas with cron validation, and Map-based scheduler service with stale-data-safe cron triggers**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-14T19:00:47Z
- **Completed:** 2026-03-14T19:03:56Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Installed hono, @hono/node-server, @hono/zod-validator, croner as project dependencies
- Created Zod input schemas with cron expression validation using croner's Cron constructor
- Built scheduler service with full lifecycle: scheduleAgent, removeAgent, startAll, stopAll
- Scheduler re-reads agent from DB on every trigger to avoid stale closures
- Updated DB schema: executionHistory.agentId now nullable with ON DELETE SET NULL
- Enabled foreign_keys pragma for SQLite FK enforcement
- Added PORT env var with default 3000

## Task Commits

Each task was committed atomically:

1. **Task 1: Install deps, update env/schema, create input schemas** - `7b95956` (feat)
2. **Task 2 RED: Failing scheduler tests** - `8f4769d` (test)
3. **Task 2 GREEN: Implement scheduler service** - `790f921` (feat)
4. **Task 2 REFACTOR: Clean up test** - `16a785a` (refactor)

## Files Created/Modified
- `src/schemas/agent-input.ts` - Zod schemas for create/update agent with cron validation
- `src/services/scheduler.ts` - Cron scheduler with Map-based job registry
- `tests/scheduler.test.ts` - 9 tests covering scheduler lifecycle and stale data
- `package.json` - Added hono, @hono/node-server, @hono/zod-validator, croner
- `src/config/env.ts` - Added PORT with z.coerce.number().default(3000)
- `src/db/schema.ts` - Made agentId nullable with ON DELETE SET NULL
- `src/db/index.ts` - Added foreign_keys pragma

## Decisions Made
- Used croner Cron constructor with `{ paused: true }` for cron validation in Zod refine -- validates syntax without starting the job
- Map-based job registry keyed by agent ID for O(1) lookup and replace (prevents ghost jobs)
- Scheduler re-reads agent from DB on each cron trigger -- avoids stale closure data and gracefully handles deleted agents

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Input schemas and scheduler service ready for Plan 02 (routes + wiring)
- Hono framework installed, ready for HTTP route creation
- @hono/zod-validator available for request validation middleware

---
*Phase: 03-management-api-and-scheduling*
*Completed: 2026-03-14*

## Self-Check: PASSED

All 3 created files verified. All 4 commit hashes verified.
