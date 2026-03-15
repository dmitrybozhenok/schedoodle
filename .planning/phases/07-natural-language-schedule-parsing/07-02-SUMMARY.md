---
phase: 07-natural-language-schedule-parsing
plan: 02
subsystem: api
tags: [hono, routes, rest-api, zod-validator, schedule-parsing, error-handling]

# Dependency graph
requires:
  - phase: 07-natural-language-schedule-parsing
    provides: parseSchedule service, parseScheduleBody schema, CircuitBreakerOpenError class
provides:
  - POST /schedules/parse HTTP endpoint for NL-to-cron translation
  - Schedule routes factory function (createScheduleRoutes)
  - Route mounted in application entry point
affects: [frontend-integration, api-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns: [Route factory with no DB dependency, zodErrorHook pattern reuse, CircuitBreakerOpenError catch for 503]

key-files:
  created:
    - src/routes/schedules.ts
    - tests/routes-schedules.test.ts
  modified:
    - src/index.ts

key-decisions:
  - "Schedule route factory takes no parameters (no DB dependency) unlike agent routes"
  - "CircuitBreakerOpenError caught for 503, all other errors caught for 422 with suggestions"
  - "zodErrorHook duplicated from agents.ts rather than shared (matches existing codebase pattern)"

patterns-established:
  - "Route factory without DB: createScheduleRoutes() for stateless service-only routes"
  - "Error differentiation: CircuitBreakerOpenError -> 503, generic Error -> 422 with guidance"

requirements-completed: [NLP-05, NLP-06, NLP-07]

# Metrics
duration: 2min
completed: 2026-03-15
---

# Phase 7 Plan 02: Schedule Parse API Endpoint Summary

**POST /schedules/parse endpoint with NL input validation, cron bypass, error differentiation (422/503), and suggestions for unparseable input**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-15T00:48:08Z
- **Completed:** 2026-03-15T00:50:00Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments
- POST /schedules/parse endpoint accepts NL input and returns cron expression with human-readable description
- Zod validation rejects empty/missing input with 400 and field-level error details
- CircuitBreakerOpenError returns 503 with fallback guidance to use raw cron expressions
- Generic parse failures return 422 with helpful suggestions array
- Route wired into main app alongside agents and health routes

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing tests for POST /schedules/parse** - `fa2a774` (test)
2. **Task 1 (GREEN): Implement POST /schedules/parse route and wire into app** - `63b9a02` (feat)

## Files Created/Modified
- `src/routes/schedules.ts` - Schedule route factory with POST /parse handler, zodErrorHook, error differentiation
- `src/index.ts` - Added import and mount for /schedules route
- `tests/routes-schedules.test.ts` - 8 tests covering NL input, cron bypass, validation, low confidence, parse errors, circuit breaker, and GET rejection

## Decisions Made
- Schedule route factory takes no parameters -- unlike createAgentRoutes(db), this route has no database dependency since it only calls the parseSchedule service
- zodErrorHook duplicated from agents.ts rather than extracting to shared module, matching the existing codebase pattern of per-route-file error hooks
- CircuitBreakerOpenError differentiated from generic errors: 503 for circuit breaker (temporary unavailability) vs 422 for parse failures (user-actionable)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- vitest v4 does not support the `-x` flag from earlier versions; used `--bail 1` equivalent instead (no impact on implementation)

## User Setup Required

None - no external service configuration required. Uses existing LLM configuration from Plan 01.

## Next Phase Readiness
- Natural language schedule parsing feature is complete (Plans 01 + 02)
- Phase 7 is the final phase -- all 7 phases of v1.0 are now complete
- Full test suite passes: 201 tests across 16 test files

## Self-Check: PASSED

- All 3 created/modified files verified on disk
- Both task commits (fa2a774, 63b9a02) verified in git history
- 8/8 route tests pass
- 201/201 full suite tests pass (no regressions)

---
*Phase: 07-natural-language-schedule-parsing*
*Completed: 2026-03-15*
