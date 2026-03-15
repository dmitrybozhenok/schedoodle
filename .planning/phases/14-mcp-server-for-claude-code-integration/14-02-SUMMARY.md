---
phase: 14-mcp-server-for-claude-code-integration
plan: 02
subsystem: api
tags: [mcp, tools, health, schedule-parsing, crud, agent-tools]

requires:
  - phase: 14-mcp-server-for-claude-code-integration (Plan 01)
    provides: MCP server with agent CRUD, history, helpers, and test infrastructure
provides:
  - Tool CRUD MCP tools (list, get, create, update, delete with confirmation)
  - Agent-tool linking MCP tools (list_agent_tools, attach_tool, detach_tool)
  - Health check MCP tool with per-agent breakdown
  - Schedule parsing MCP tool with CircuitBreakerOpenError handling
  - Complete 17-tool MCP surface
affects: [phase-15-telegram-notification-channel]

tech-stack:
  added: []
  patterns: [inArray query for agent-tool joins, and() for precise compound deletes]

key-files:
  created:
    - src/mcp/tools/tools.ts
    - src/mcp/tools/health.ts
    - src/mcp/tools/schedules.ts
    - tests/mcp-tools.test.ts
    - tests/mcp-health.test.ts
  modified:
    - src/mcp.ts

key-decisions:
  - "inArray query for fetching attached tools by IDs from join table (avoids N+1)"
  - "and() compound WHERE clause for precise agent-tool link deletion (not just agentId)"
  - "Health tool imports getLlmCircuitStatus and getLlmSemaphoreStatus directly from executor (MCP process has its own state)"
  - "upcomingRuns returned as string note rather than data (MCP server has no scheduler process)"
  - "Schedule parsing tool catches CircuitBreakerOpenError for specific LLM-unavailable guidance"

patterns-established:
  - "InMemoryTransport + Client pattern reused for tool CRUD and health test suites"
  - "destructiveHint annotation on delete_tool matching delete_agent pattern"
  - "Two-step confirm flow on delete_tool matching delete_agent pattern"

requirements-completed: [MCP-10, MCP-11, MCP-12, MCP-13, MCP-14, MCP-15, MCP-16, MCP-17]

duration: 5min
completed: 2026-03-15
---

# Phase 14 Plan 02: MCP Tools, Health, and Schedule Summary

**10 additional MCP tools (tool CRUD, agent-tool linking, health, schedule parsing) completing the full 17-tool MCP surface with 29 new tests**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-15T12:59:10Z
- **Completed:** 2026-03-15T13:04:25Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Implemented 8 tool management MCP tools: list, get, create, update, delete (with two-step confirmation), list_agent_tools, attach, detach
- Implemented get_health MCP tool mirroring REST health data with per-agent breakdown, circuit breaker state, and concurrency stats
- Implemented parse_schedule MCP tool with CircuitBreakerOpenError handling and actionable error guidance
- All 17 MCP tools registered and wired into the entrypoint
- 29 new tests covering tool CRUD, agent-tool linking, health status computation, and schedule parsing

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement tool CRUD, agent-tool linking, health, and schedule MCP tools** - `8556283` (feat)
2. **Task 2: Unit tests for tool, health, and schedule MCP tool handlers** - `2e9fb05` (test)

## Files Created/Modified
- `src/mcp/tools/tools.ts` - Tool CRUD (list, get, create, update, delete) and agent-tool linking (list, attach, detach) MCP handlers
- `src/mcp/tools/health.ts` - Health check MCP tool with per-agent breakdown, circuit breaker, and concurrency status
- `src/mcp/tools/schedules.ts` - Schedule parsing MCP tool with CircuitBreakerOpenError handling
- `src/mcp.ts` - Updated to import and register all 5 tool groups (17 tools total)
- `tests/mcp-tools.test.ts` - 22 tests for tool CRUD and agent-tool linking
- `tests/mcp-health.test.ts` - 7 health tests and 4 schedule parsing tests

## Decisions Made
- Used `inArray` query for fetching attached tools by IDs from join table (avoids N+1, matches Phase 09 pattern)
- Used `and()` compound WHERE clause for precise agent-tool link deletion (not just by agentId which would delete all links)
- Health tool imports `getLlmCircuitStatus` and `getLlmSemaphoreStatus` directly from executor module (MCP process has its own circuit breaker state)
- `upcomingRuns` returned as informational string note rather than data (MCP server has no scheduler, scheduler runs in HTTP server process)
- Schedule parsing tool catches `CircuitBreakerOpenError` specifically for "use cron directly" guidance, other errors get generic suggestions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed detach_tool deleting all agent links instead of specific one**
- **Found during:** Task 1 (detach_tool implementation)
- **Issue:** Initial implementation used `eq(agentTools.agentId, agentId)` which would delete ALL tool links for an agent, not just the specific one
- **Fix:** Used `and(eq(agentTools.agentId, agentId), eq(agentTools.toolId, toolId))` for precise compound delete
- **Files modified:** src/mcp/tools/tools.ts
- **Verification:** detach_tool tests pass, only specified link removed
- **Committed in:** 8556283 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential correctness fix. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 14 (MCP Server) is complete with all 17 tools registered and tested
- Full test suite green (474 tests across 32 files)
- Ready for Phase 15 (Telegram Notification Channel)

## Self-Check: PASSED

All 6 files verified present. Both task commits (8556283, 2e9fb05) verified in git log.

---
*Phase: 14-mcp-server-for-claude-code-integration*
*Completed: 2026-03-15*
