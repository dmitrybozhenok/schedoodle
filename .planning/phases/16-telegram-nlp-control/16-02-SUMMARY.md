---
phase: 16-telegram-nlp-control
plan: 02
subsystem: telegram-control
tags: [telegram, nlp, command-handlers, polling-integration, bot-control]

# Dependency graph
requires:
  - phase: 16-telegram-nlp-control
    provides: Intent schema, parseIntent LLM parser, Telegram polling loop, sendPlainText and sendTypingAction
  - phase: 07-schedule-parsing
    provides: parseSchedule NL-to-cron function
  - phase: 06-agent-enabled-flag
    provides: enrichAgent with enabled/healthy flags, scheduleAgent/removeAgent
provides:
  - Complete Telegram bot command handler dispatch for all 7 intents plus unknown fallback
  - Polling loop integrated into index.ts startup and graceful shutdown
  - Fire-and-forget agent execution via Telegram "run" command
  - Case-insensitive agent name lookup with COLLATE NOCASE
  - System health summary via Telegram "status" command
affects: [telegram-nlp-control]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Command handler dispatch via switch on intent.action with async/sync handlers"
    - "Fire-and-forget pattern: void executeAgent(agent, db).catch() for run command"
    - "Case-insensitive SQL lookup: COLLATE NOCASE on both sides of comparison"
    - "Conditional polling startup: guard on both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID"

key-files:
  created:
    - src/services/telegram-commands.ts
    - tests/telegram-commands.test.ts
  modified:
    - src/index.ts

key-decisions:
  - "enrichAgent and getConsecutiveFailures imported directly for list and status handlers (reuse existing health computation)"
  - "Run command does NOT check agent.enabled (disabled agents can be manually executed, matching Phase 6 decision)"
  - "Slash commands /start and /help checked before any LLM call (no parseIntent overhead)"
  - "stopPolling() placed unconditionally in shutdown (no-op if not started)"
  - "Typing indicator silently swallowed on error via .catch(() => {}) to avoid blocking message flow"

patterns-established:
  - "Telegram command handler pattern: handleTelegramMessage as single exported entry point dispatching to internal handlers"
  - "Agent name resolution pattern: COLLATE NOCASE SQL for case-insensitive fuzzy match"

requirements-completed: [TGCTL-02, TGCTL-05, TGCTL-06, TGCTL-07, TGCTL-08, TGCTL-09, TGCTL-11, TGCTL-12]

# Metrics
duration: 4min
completed: 2026-03-16
---

# Phase 16 Plan 02: Telegram NLP Control - Command Handlers and Polling Integration Summary

**Command handler dispatch for 7 Telegram bot intents (list, run, enable, disable, status, reschedule, help) with polling wired into app lifecycle**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-16T01:25:34Z
- **Completed:** 2026-03-16T01:29:45Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- All 7 command handlers implemented: help, list, run, enable, disable, status, reschedule plus unknown fallback
- /start and /help bypass LLM entirely for instant response
- Run command uses fire-and-forget executeAgent pattern (disabled agents can be manually executed)
- Polling loop starts after scheduler in index.ts when both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set
- stopPolling called during graceful shutdown
- 14 unit tests covering all intents, edge cases, typing indicators, and error guidance
- Full test suite green: 542 tests across 37 files, zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create command handlers for all Telegram bot intents** - `a309ce8` (feat)
2. **Task 2: Wire polling into application startup and graceful shutdown** - `f2f5e8d` (feat)

## Files Created/Modified
- `src/services/telegram-commands.ts` - Command handler dispatch for all Telegram bot intents (289 lines)
- `tests/telegram-commands.test.ts` - 14 tests for all command handlers and edge cases (423 lines)
- `src/index.ts` - Polling startup after scheduler and stopPolling in shutdown

## Decisions Made
- enrichAgent and getConsecutiveFailures imported directly for list and status handlers (reuse existing health computation logic)
- Run command does NOT check agent.enabled -- disabled agents can still be manually executed (per Phase 6 decision that POST /:id/execute works on disabled agents)
- Slash commands /start and /help checked before any LLM call to avoid parseIntent overhead
- stopPolling() placed unconditionally in shutdown (it's a no-op if not started since it just sets running = false)
- Typing indicator silently swallowed on error via .catch(() => {}) to avoid blocking message processing flow

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added enrichAgent mock to test file**
- **Found during:** Task 1 (test creation)
- **Issue:** Mock DB did not support chained orderBy/limit queries that enrichAgent uses internally via getConsecutiveFailures
- **Fix:** Added vi.mock for enrich-agent.js with mockEnrichAgent and mockGetConsecutiveFailures to isolate command handler logic
- **Files modified:** tests/telegram-commands.test.ts
- **Verification:** All 14 tests pass
- **Committed in:** a309ce8 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Standard test mock setup adjustment, no scope change.

## Issues Encountered

None beyond the mock setup described above.

## User Setup Required

None - TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID already configured from Phase 15.

## Next Phase Readiness
- Phase 16 is now fully complete: two-way Telegram NLP control interface operational
- All 12 TGCTL requirements covered across Plans 01 and 02
- Full test suite green (542 tests, 37 files)

## Self-Check: PASSED

All 3 files verified present. Both task commits (a309ce8, f2f5e8d) verified in git log.

---
*Phase: 16-telegram-nlp-control*
*Completed: 2026-03-16*
