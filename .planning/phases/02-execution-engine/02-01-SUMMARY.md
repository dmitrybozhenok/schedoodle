---
phase: 02-execution-engine
plan: 01
subsystem: api
tags: [ai-sdk, anthropic, zod, html-to-text, prefetch, structured-output]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: DB schema with agents/executionHistory tables, Zod v4 validation, env config
provides:
  - Shared Zod output schema (agentOutputSchema) for LLM structured output
  - URL pre-fetch service with graceful degradation
  - Model column on agents table for per-agent model configuration
  - AI SDK dependencies (ai, @ai-sdk/anthropic)
affects: [02-execution-engine, 03-scheduling]

# Tech tracking
tech-stack:
  added: [ai@6.0.116, "@ai-sdk/anthropic@3.0.58", html-to-text@9.0.5, "@types/html-to-text@9.0.4"]
  patterns: [vi.mock for module mocking, Promise.allSettled for concurrent fetches, Zod schema with .describe() for LLM output]

key-files:
  created:
    - src/schemas/agent-output.ts
    - src/services/prefetch.ts
    - tests/schemas.test.ts
    - tests/prefetch.test.ts
  modified:
    - src/db/schema.ts
    - package.json
    - pnpm-lock.yaml
    - tests/db.test.ts

key-decisions:
  - "Zod imported from 'zod' (not 'zod/v4') matching project convention"
  - "URL regex pattern /https?:\\/\\/[^\\s)>\\]]+/g for URL extraction from prose text"
  - "html-to-text convert() with wordwrap: 120 for HTML-to-plaintext conversion"

patterns-established:
  - "Zod schemas in src/schemas/ directory with exported type inference"
  - "Service functions in src/services/ as pure functions with injected dependencies"
  - "vi.mock for module-level mocking, vi.fn() for globalThis.fetch mocking"

requirements-completed: [EXEC-04, EXEC-02]

# Metrics
duration: 3min
completed: 2026-03-14
---

# Phase 2 Plan 1: Execution Engine Foundation Summary

**AI SDK deps installed, shared Zod output schema, URL pre-fetch service with HTML conversion and graceful degradation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-14T18:21:23Z
- **Completed:** 2026-03-14T18:24:42Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Installed AI SDK (ai, @ai-sdk/anthropic) and html-to-text dependencies
- Created shared agentOutputSchema validating { summary, details, data? } for structured LLM output
- Built URL pre-fetch service: extractUrls, prefetchUrls (10s timeout, HTML-to-text, JSON passthrough), buildPrompt
- Added nullable model column to agents table for per-agent model configuration
- 26 total tests passing across 4 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Install deps, add model column, create output schema** - `133c300` (feat)
2. **Task 2: Create URL pre-fetch service with graceful degradation** - `ea3050a` (feat)

_Note: TDD tasks - tests written before implementation, verified RED then GREEN._

## Files Created/Modified
- `src/schemas/agent-output.ts` - Shared Zod v1 output schema with AgentOutput type
- `src/services/prefetch.ts` - URL extraction, pre-fetch with timeout, HTML conversion, prompt building
- `src/db/schema.ts` - Added nullable model column to agents table
- `tests/schemas.test.ts` - 5 tests for output schema validation
- `tests/prefetch.test.ts` - 10 tests for pre-fetch service
- `tests/db.test.ts` - Updated in-memory SQL to include model column
- `package.json` - Added ai, @ai-sdk/anthropic, html-to-text dependencies

## Decisions Made
- Imported Zod from "zod" (not "zod/v4") matching the existing project convention
- Used regex `/https?:\/\/[^\s)>\]]+/g` for URL extraction -- simple and sufficient for prose text
- Used html-to-text library's `convert()` with `wordwrap: 120` for HTML-to-plaintext

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated db.test.ts in-memory SQL for model column**
- **Found during:** Task 2 (full test suite verification)
- **Issue:** db.test.ts uses hardcoded CREATE TABLE SQL; adding model column to schema.ts broke the in-memory table alignment
- **Fix:** Added `model TEXT` column to CREATE_AGENTS_SQL and added model column check to schema verification test
- **Files modified:** tests/db.test.ts
- **Verification:** All 26 tests pass
- **Committed in:** ea3050a (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary fix for test-schema alignment. No scope creep.

## Issues Encountered
- data/ directory did not exist for db:push -- created it before running schema push

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Output schema and pre-fetch service ready for executor function (Plan 02-02)
- AI SDK dependencies installed and available
- Model column available for per-agent model selection

---
*Phase: 02-execution-engine*
*Completed: 2026-03-14*
