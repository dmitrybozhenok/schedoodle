---
phase: 07-natural-language-schedule-parsing
plan: 01
subsystem: api
tags: [cronstrue, cron, natural-language, llm, ai-sdk, zod, structured-output]

# Dependency graph
requires:
  - phase: 06-agent-enabled-flag-and-schedule-controls
    provides: agent CRUD and scheduling infrastructure
provides:
  - isCronExpression helper for cron vs NL detection
  - Zod schemas for schedule parse request/response and LLM structured output
  - parseSchedule service for NL-to-cron translation via LLM with cronstrue descriptions
affects: [07-02-PLAN (route layer), schedule-related features]

# Tech tracking
tech-stack:
  added: [cronstrue@3.13.0]
  patterns: [LLM-based NL-to-cron with structured output, cron detection heuristic, 24h cronstrue formatting]

key-files:
  created:
    - src/helpers/cron-detect.ts
    - src/schemas/schedule-input.ts
    - src/services/schedule-parser.ts
    - tests/cron-detect.test.ts
    - tests/schedule-parser.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "24h time format for cronstrue output (use24HourTimeFormat: true) for consistency"
  - "No circuit breaker wrapping for schedule parsing -- user-interactive endpoint gets clear errors"
  - "Single retry with error feedback on NoObjectGeneratedError, matching executor.ts pattern"

patterns-established:
  - "Cron detection: field count + character regex + croner validation triple-check"
  - "LLM structured output: generateText + Output.object with Zod schema for type-safe extraction"
  - "cronstrue with use24HourTimeFormat: true for all human-readable cron descriptions"

requirements-completed: [NLP-01, NLP-02, NLP-03, NLP-04]

# Metrics
duration: 3min
completed: 2026-03-15
---

# Phase 7 Plan 01: Core Schedule Parsing Service Summary

**NL-to-cron parsing service with LLM structured output, cron detection helper, and cronstrue descriptions using 24h format**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-15T00:42:08Z
- **Completed:** 2026-03-15T00:45:11Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- isCronExpression helper reliably distinguishes valid cron expressions from natural language using field count, character regex, and croner validation
- parseSchedule service translates NL to cron via LLM with structured Zod output, validates with croner, and describes with cronstrue
- Cron input bypass skips LLM call entirely for already-valid cron expressions
- Low-confidence results include warning field guiding users to verify

## Task Commits

Each task was committed atomically:

1. **Task 1: Install cronstrue and create cron detection helper with tests** - `177f1cd` (feat)
2. **Task 2: Create schedule parse schemas and NL-to-cron parser service with tests** - `c8cdd47` (feat)

## Files Created/Modified
- `src/helpers/cron-detect.ts` - isCronExpression function with triple validation (field count, chars, croner)
- `src/schemas/schedule-input.ts` - Zod schemas for parse request body and LLM structured output, plus response types
- `src/services/schedule-parser.ts` - parseSchedule service with cron bypass, LLM translation, retry, and cronstrue
- `tests/cron-detect.test.ts` - 9 tests covering valid cron, NL text, empty, and edge cases
- `tests/schedule-parser.test.ts` - 7 tests with mocked LLM covering NL, cron bypass, low confidence, invalid cron, retry
- `package.json` - Added cronstrue@3.13.0 dependency
- `pnpm-lock.yaml` - Updated lockfile

## Decisions Made
- Used 24h time format (`use24HourTimeFormat: true`) for cronstrue output to match research examples and avoid AM/PM ambiguity
- No circuit breaker wrapping for schedule parsing -- it is a user-interactive query that should get clear errors rather than fail-fast from execution circuit state
- Single retry with error feedback on NoObjectGeneratedError, following the established executor.ts pattern
- Cron character regex allows L, W, # for extended cron support but LLM prompt restricts to standard 5-field

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- cronstrue default output uses AM/PM format ("At 09:00 AM") while research doc examples showed 24h format ("At 09:00") -- resolved by passing `use24HourTimeFormat: true` option

## User Setup Required

None - no external service configuration required. Uses existing LLM configuration.

## Next Phase Readiness
- Service layer complete, ready for Plan 02 (POST /schedules/parse route)
- parseSchedule function is the single entry point the route handler will call
- ParseScheduleResponse type defines the exact shape for API responses

## Self-Check: PASSED

- All 5 created files verified on disk
- Both task commits (177f1cd, c8cdd47) verified in git history
- 16/16 tests pass (9 cron-detect + 7 schedule-parser)
- 193/193 full suite tests pass (no regressions)
- cronstrue verified in package.json dependencies

---
*Phase: 07-natural-language-schedule-parsing*
*Completed: 2026-03-15*
