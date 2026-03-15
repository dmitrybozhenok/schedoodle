---
phase: 14-mcp-server-for-claude-code-integration
plan: 01
subsystem: api
tags: [mcp, stdio, model-context-protocol, claude-code, agent-management]

# Dependency graph
requires:
  - phase: 03-management-api
    provides: Agent CRUD patterns, enrichAgent, DB schema
  - phase: 07-natural-language-schedule-parsing
    provides: parseSchedule for NL schedule resolution
  - phase: 12-llm-concurrency-limits-and-graceful-shutdown
    provides: executeAgent with concurrency control
provides:
  - MCP server entrypoint with stdio transport (src/mcp.ts)
  - Agent CRUD MCP tools (list, get, create, update, delete with confirmation)
  - Agent execution MCP tool (synchronous)
  - Execution history MCP tool
  - Shared MCP response formatting utilities
affects: [14-02-PLAN]

# Tech tracking
tech-stack:
  added: ["@modelcontextprotocol/sdk v1.27.1"]
  patterns: [registerTool with Zod v4 inputSchema, InMemoryTransport for MCP testing, two-step destructive confirmation, error guidance pattern]

key-files:
  created:
    - src/mcp.ts
    - src/mcp/helpers.ts
    - src/mcp/tools/agents.ts
    - src/mcp/tools/history.ts
    - tests/mcp-agents.test.ts
  modified:
    - package.json

key-decisions:
  - "InMemoryTransport + Client for in-process MCP tool testing (no stdio, no protocol-level tests)"
  - "All MCP tool handlers are thin wrappers calling existing services and DB queries directly"
  - "Error responses use { error, guidance } shape for Claude self-correction"
  - "delete_agent uses two-step confirm flow with destructiveHint annotation"
  - "MCP server does NOT call scheduleAgent/removeAgent (no scheduler in MCP process)"

patterns-established:
  - "registerXTools(server, db) factory pattern for MCP tool registration by domain"
  - "jsonResponse/errorResponse helpers for consistent MCP response formatting"
  - "InMemoryTransport.createLinkedPair() for MCP integration tests"
  - "Two-step destructive confirmation with confirm boolean parameter"

requirements-completed: [MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06, MCP-07, MCP-08, MCP-09]

# Metrics
duration: 5min
completed: 2026-03-15
---

# Phase 14 Plan 01: MCP Server Foundation Summary

**MCP server with stdio transport, 7 agent management tools using @modelcontextprotocol/sdk, and 23 unit tests via InMemoryTransport**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-15T12:50:43Z
- **Completed:** 2026-03-15T12:56:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Installed @modelcontextprotocol/sdk v1.27.1 and created MCP server entrypoint with stdio transport
- Implemented 7 MCP tools: list_agents, get_agent, create_agent, update_agent, delete_agent (with two-step confirmation), execute_agent, get_execution_history
- All tools use Zod v4 inputSchemas with .describe() for rich tool documentation
- Created shared helpers (jsonResponse, errorResponse) for consistent response formatting
- 23 tests covering all tool handlers using InMemoryTransport for in-process client/server testing

## Task Commits

Each task was committed atomically:

1. **Task 1: Install MCP SDK, create entrypoint, helpers, and tool handlers** - `cf53d16` (feat)
2. **Task 2: Unit tests for agent and history MCP tool handlers** - `ea3c9eb` (test)

## Files Created/Modified
- `src/mcp.ts` - MCP server entrypoint with stdio transport, registers all tool groups
- `src/mcp/helpers.ts` - Shared jsonResponse and errorResponse formatting utilities
- `src/mcp/tools/agents.ts` - 6 agent management tools (list, get, create, update, delete, execute)
- `src/mcp/tools/history.ts` - Execution history retrieval tool
- `tests/mcp-agents.test.ts` - 23 unit tests for all MCP tool handlers
- `package.json` - Added mcp/mcp:start scripts and @modelcontextprotocol/sdk dependency

## Decisions Made
- Used InMemoryTransport + Client for in-process MCP tool testing instead of testing handler functions directly -- provides full integration coverage including schema validation
- MCP server does NOT call scheduleAgent/removeAgent (per locked decision: no scheduler in MCP process, avoids dual-process cron conflicts)
- Error responses include { error, guidance } shape to help Claude self-correct
- delete_agent uses two-step confirmation: default call returns preview, confirm=true performs deletion
- All console.log avoided in MCP code paths (only console.error) since stdout is the MCP transport

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. MCP server configuration (.mcp.json) will be documented in Plan 02.

## Next Phase Readiness
- MCP server foundation is complete with 7 agent-related tools
- Plan 02 will add remaining tools: tool CRUD, health, schedule parsing, agent-tool links
- src/mcp.ts has a comment placeholder for Plan 02's additional registerXTools calls

## Self-Check: PASSED

All 5 created files verified on disk. Both task commits (cf53d16, ea3c9eb) verified in git log.

---
*Phase: 14-mcp-server-for-claude-code-integration*
*Completed: 2026-03-15*
