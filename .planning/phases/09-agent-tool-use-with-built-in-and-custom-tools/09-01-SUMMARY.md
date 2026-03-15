---
phase: 09-agent-tool-use
plan: 01
subsystem: api, database, services
tags: [ai-sdk, tool-calling, brave-search, webhook, drizzle, zod]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: DB schema, env config, type definitions
  - phase: 02-execution-engine
    provides: prefetch.ts pattern, html-to-text usage, executor.ts
provides:
  - tools table with full CRUD schema (id, name, description, url, method, headers, inputSchema)
  - agentTools join table with cascade deletes for many-to-many agent-tool linking
  - maxExecutionMs nullable column on agents table for per-agent timeout budget
  - toolCalls JSON column on executionHistory for tool call logging
  - BRAVE_API_KEY optional env var in config
  - webFetchTool AI SDK tool instance (HTML-to-text, error handling, abort signals)
  - webSearchTool AI SDK tool instance (Brave Search API, graceful degradation)
  - createWebhookTool factory converting DB records to AI SDK tools
  - buildToolSet combining built-in + custom tools into a single toolSet record
  - Tool, NewTool, AgentTool type exports
  - createToolSchema and updateToolSchema Zod validation schemas
affects: [09-02 (tool CRUD routes, executor integration), 09-03 (agent-tool attachment)]

# Tech tracking
tech-stack:
  added: []
  patterns: [AI SDK tool() with inputSchema, jsonSchema() for dynamic schemas, AbortSignal.any() for combined timeouts, custom_ prefix for tool registry deduplication]

key-files:
  created:
    - src/services/tools/web-fetch.ts
    - src/services/tools/web-search.ts
    - src/services/tools/webhook.ts
    - src/services/tools/registry.ts
    - src/schemas/tool-input.ts
    - tests/tools-web-fetch.test.ts
    - tests/tools-web-search.test.ts
    - tests/tools-webhook.test.ts
    - tests/tools-registry.test.ts
  modified:
    - src/db/schema.ts
    - src/config/env.ts
    - src/types/index.ts
    - tests/db.test.ts
    - tests/executor.test.ts
    - tests/helpers-enrich-agent.test.ts
    - tests/routes-agents.test.ts
    - tests/health.test.ts
    - tests/scheduler.test.ts

key-decisions:
  - "AI SDK 6 tool() uses inputSchema (not parameters) for TypeScript compatibility"
  - "Webhook tool uses direct object literal instead of tool() helper for jsonSchema() compatibility"
  - "Custom tools in registry prefixed with custom_ to prevent built-in name collisions"
  - "z.record(z.string(), z.any()) for inputSchema validation (Zod v4 compatibility)"
  - "z.record(z.string(), z.string()) for headers validation (Zod v4 requires explicit key+value types)"
  - "AbortSignal conditional push pattern for optional abortSignal (may be undefined in AI SDK types)"

patterns-established:
  - "AI SDK tool pattern: inputSchema with Zod schema, execute with try/catch returning error string"
  - "Webhook factory pattern: DB record to AI SDK tool via jsonSchema() wrapper"
  - "Tool registry pattern: built-in tools + custom_prefixed user tools in single Record"
  - "Combined timeout pattern: AbortSignal.any([timeout(10000), parentSignal]) per tool call"

requirements-completed: [TOOL-01, TOOL-02, TOOL-03, TOOL-09, TOOL-10]

# Metrics
duration: 11min
completed: 2026-03-15
---

# Phase 9 Plan 01: Data Model and Tool Definitions Summary

**DB schema for tools/agent-tools/maxExecutionMs/toolCalls, web_fetch and web_search built-in tools, webhook factory, and tool registry combining all tools into a single toolSet**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-15T03:20:15Z
- **Completed:** 2026-03-15T03:31:45Z
- **Tasks:** 3
- **Files modified:** 18

## Accomplishments
- Database schema extended with tools table, agentTools join table, maxExecutionMs on agents, toolCalls on executionHistory
- Two built-in AI SDK tools implemented: web_fetch (HTML-to-text conversion) and web_search (Brave Search API)
- Webhook tool factory converts DB tool records into AI SDK tools at runtime
- Tool registry combines built-in and custom tools into a single Record for generateText
- All 286 tests pass with zero regressions across 20 test files

## Task Commits

Each task was committed atomically (TDD: test -> feat):

1. **Task 1: Database schema additions and env config** - `595f12f` (test) -> `f252048` (feat)
2. **Task 2: Built-in tool definitions (web_fetch and web_search)** - `f081521` (test) -> `14e2f8c` (feat)
3. **Task 3: Webhook tool factory and tool registry** - `f496243` (test) -> `b041c57` (feat)

## Files Created/Modified

### Created
- `src/db/schema.ts` - tools table, agentTools join table, maxExecutionMs, toolCalls columns
- `src/services/tools/web-fetch.ts` - Built-in web_fetch AI SDK tool (HTML to text, error handling)
- `src/services/tools/web-search.ts` - Built-in web_search AI SDK tool (Brave Search API)
- `src/services/tools/webhook.ts` - Factory creating AI SDK tools from DB tool records
- `src/services/tools/registry.ts` - Combines built-in + custom tools into a single toolSet
- `src/schemas/tool-input.ts` - Zod validation schemas for tool CRUD (createToolSchema, updateToolSchema)
- `tests/tools-web-fetch.test.ts` - 6 tests for web_fetch tool behavior
- `tests/tools-web-search.test.ts` - 8 tests for web_search tool behavior
- `tests/tools-webhook.test.ts` - 7 tests for webhook tool factory
- `tests/tools-registry.test.ts` - 6 tests for tool registry

### Modified
- `src/config/env.ts` - Added BRAVE_API_KEY optional env var
- `src/types/index.ts` - Added Tool, NewTool, AgentTool type exports
- `tests/db.test.ts` - Added 13 tests for tools schema, join table, validation
- `tests/executor.test.ts` - Updated CREATE TABLE SQL with new columns
- `tests/helpers-enrich-agent.test.ts` - Updated CREATE TABLE SQL with new columns
- `tests/routes-agents.test.ts` - Updated CREATE TABLE SQL with new columns
- `tests/health.test.ts` - Updated CREATE TABLE SQL with new columns
- `tests/scheduler.test.ts` - Updated CREATE TABLE SQL with new columns

## Decisions Made

- **AI SDK tool() uses inputSchema (not parameters):** The AI SDK 6 TypeScript types expect `inputSchema` property. While `parameters` works at runtime (tool() is identity function), using `inputSchema` ensures clean TypeScript compilation.
- **Webhook uses object literal instead of tool() helper:** The `jsonSchema()` wrapper returns `Schema<unknown>`, which conflicts with `tool()`'s type inference when execute is present. Direct object literal with explicit type annotation avoids this.
- **Custom tool keys prefixed with custom_:** Registry keys like `custom_my_api` prevent name collisions with built-in tools (web_fetch, web_search).
- **Zod v4 record requires explicit key+value types:** `z.record(z.string())` fails in Zod v4; must use `z.record(z.string(), z.string())`. Similarly, `z.record(z.string(), z.any())` for arbitrary JSON.
- **AbortSignal conditional push pattern:** AI SDK types declare `abortSignal` as `AbortSignal | undefined`, so we conditionally push it into the signals array before calling `AbortSignal.any()`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Zod v4 inputSchema validation**
- **Found during:** Task 1 (tool-input.ts schema)
- **Issue:** `z.object({}).passthrough()` and `z.record(z.string())` fail in Zod v4 (TypeError: Cannot read properties of undefined)
- **Fix:** Used `z.record(z.string(), z.any())` for inputSchema and `z.record(z.string(), z.string())` for headers
- **Files modified:** src/schemas/tool-input.ts
- **Verification:** All 24 db tests pass
- **Committed in:** f252048

**2. [Rule 1 - Bug] Fixed html-to-text heading case in test assertion**
- **Found during:** Task 2 (web_fetch tests)
- **Issue:** html-to-text converts H1 headings to uppercase ("HELLO WORLD" not "Hello World")
- **Fix:** Updated test assertion to expect uppercase heading output
- **Files modified:** tests/tools-web-fetch.test.ts
- **Verification:** All 6 web_fetch tests pass
- **Committed in:** 14e2f8c

**3. [Rule 3 - Blocking] Fixed vi.mock hoisting issue in web_search tests**
- **Found during:** Task 2 (web_search tests)
- **Issue:** `mockEnv` variable referenced before initialization due to vi.mock hoisting
- **Fix:** Used `vi.hoisted()` to declare mockEnv before the hoisted vi.mock factory
- **Files modified:** tests/tools-web-search.test.ts
- **Verification:** All 8 web_search tests pass
- **Committed in:** 14e2f8c

**4. [Rule 3 - Blocking] Fixed TypeScript compilation errors with AI SDK tool() types**
- **Found during:** Task 3 (webhook + registry)
- **Issue:** AI SDK 6 tool() TypeScript types incompatible with `parameters` property name and `jsonSchema()` return type
- **Fix:** Used `inputSchema` property name, direct object literal for webhook tool, conditional AbortSignal push pattern, explicit AnyTool type alias for registry
- **Files modified:** src/services/tools/web-fetch.ts, web-search.ts, webhook.ts, registry.ts
- **Verification:** `tsc --noEmit` compiles cleanly
- **Committed in:** b041c57

---

**Total deviations:** 4 auto-fixed (2 bugs, 2 blocking)
**Impact on plan:** All fixes were necessary for correctness and compilation. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required. BRAVE_API_KEY is optional and only needed for web search functionality.

## Next Phase Readiness
- All tool foundations are in place for Plans 02 and 03
- Plan 02 can implement /tools CRUD routes using createToolSchema/updateToolSchema and the tools table
- Plan 02 can modify executor.ts to use buildToolSet with generateText
- Plan 03 can implement agent-tool attachment using agentTools join table

## Self-Check: PASSED

All 12 created/modified source files verified on disk. All 6 task commits verified in git history. 286 tests pass across 20 test files. TypeScript compiles cleanly.

---
*Phase: 09-agent-tool-use-with-built-in-and-custom-tools*
*Completed: 2026-03-15*
