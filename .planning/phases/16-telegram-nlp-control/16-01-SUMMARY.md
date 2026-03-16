---
phase: 16-telegram-nlp-control
plan: 01
subsystem: telegram-control
tags: [telegram, nlp, intent-parsing, polling, ai-sdk, zod]

# Dependency graph
requires:
  - phase: 15-telegram-notification-channel
    provides: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars, sendTelegramMessage utility
  - phase: 07-schedule-parsing
    provides: generateText + Output.object + NoObjectGeneratedError retry pattern
provides:
  - Zod intent schema with 7 action types for Telegram command parsing
  - LLM-based intent parser with fuzzy agent name resolution
  - Telegram getUpdates polling loop with offset tracking and chat ID security
  - Plain text reply and typing indicator helpers
affects: [16-02-command-handlers, telegram-nlp-control]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LLM intent extraction via generateText + Output.object with system prompt containing agent list"
    - "Telegram getUpdates long-polling with offset tracking and error recovery backoff"
    - "Plain text responses for bot control (no MarkdownV2) to avoid escaping complexity"

key-files:
  created:
    - src/schemas/telegram-intent.ts
    - src/services/intent-parser.ts
    - src/services/telegram-poller.ts
    - tests/intent-parser.test.ts
    - tests/telegram-poller.test.ts
  modified: []

key-decisions:
  - "Intent schema uses nullable agentName and scheduleInput fields (null when not applicable to action)"
  - "Chat ID security guard placed inside polling loop before onMessage callback (not in separate middleware)"
  - "Plain text for bot control responses (no parse_mode) per research recommendation to avoid escaping headaches"
  - "Fire-and-forget poll() invocation via void poll() to start the async loop"

patterns-established:
  - "Intent schema pattern: z.enum for actions + nullable string fields for optional parameters"
  - "Polling loop pattern: while(running) + try/catch + offset tracking + 5s error backoff"
  - "sendPlainText helper: Telegram sendMessage without parse_mode for simple control responses"

requirements-completed: [TGCTL-01, TGCTL-03, TGCTL-04, TGCTL-10]

# Metrics
duration: 3min
completed: 2026-03-16
---

# Phase 16 Plan 01: Telegram NLP Control - Intent Parsing and Polling Summary

**LLM intent parser with 7 action types and Telegram getUpdates polling loop with chat ID security and offset tracking**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-16T01:19:47Z
- **Completed:** 2026-03-16T01:22:47Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Intent schema with 7 action types (list, run, enable, disable, status, reschedule, unknown) plus nullable agentName and scheduleInput
- LLM intent parser using generateText + Output.object with NoObjectGeneratedError single-retry pattern, matching schedule-parser.ts convention
- Telegram polling loop with getUpdates long-polling (30s timeout), offset tracking, and chat ID security guard
- Helper functions for plain text replies and typing indicators
- 16 unit tests (7 intent parser + 9 poller) covering all functionality

## Task Commits

Each task was committed atomically:

1. **Task 1: Create intent schema and LLM intent parser** - `07a4e9e` (feat)
2. **Task 2: Create Telegram polling loop with offset tracking and chat ID security** - `dbec340` (feat)

## Files Created/Modified
- `src/schemas/telegram-intent.ts` - Zod schema with 7 action types, nullable agentName and scheduleInput
- `src/services/intent-parser.ts` - LLM-based intent extraction with fuzzy agent name resolution and retry logic
- `src/services/telegram-poller.ts` - getUpdates polling loop, startPolling/stopPolling, sendPlainText, sendTypingAction
- `tests/intent-parser.test.ts` - 7 tests: all action types, retry on NoObjectGeneratedError, error propagation, agent list in prompt
- `tests/telegram-poller.test.ts` - 9 tests: URL/params, offset tracking, auth chat ID, unauthorized rejection, no-text updates, error recovery, stop, sendPlainText, sendTypingAction

## Decisions Made
- Intent schema uses nullable agentName and scheduleInput fields (null when not applicable to action type)
- Chat ID security guard placed inside the polling loop before invoking onMessage callback
- Plain text for bot control responses (no parse_mode) per research recommendation
- Fire-and-forget poll() invocation via void poll() to start the async loop without blocking
- System prompt contains numbered agent list for semantic name resolution by LLM

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID already configured from Phase 15).

## Next Phase Readiness
- Intent schema and parser ready for Plan 02 command handlers to consume
- Polling loop exports startPolling/stopPolling for integration into index.ts shutdown flow
- sendPlainText and sendTypingAction ready for command response delivery
- Full test suite green (528 tests, 36 files, zero regressions)

## Self-Check: PASSED

All 6 files verified present. Both task commits (07a4e9e, dbec340) verified in git log.

---
*Phase: 16-telegram-nlp-control*
*Completed: 2026-03-16*
