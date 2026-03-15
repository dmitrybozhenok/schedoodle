---
phase: 09-agent-tool-use-with-built-in-and-custom-tools
verified: 2026-03-15T03:45:00Z
status: gaps_found
score: 17/19 must-haves verified
gaps:
  - truth: "Schema changes compile: pnpm tsc --noEmit"
    status: failed
    reason: "TypeScript reports 2 errors in src/routes/tools.ts — the method field is cast as plain string but Drizzle requires the literal enum type"
    artifacts:
      - path: "src/routes/tools.ts"
        issue: "Line 61: method typed as string (from Zod c.req.valid cast) passed to Drizzle insert which requires 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'. Same mismatch on line 117 in the PATCH spread."
    missing:
      - "Cast method to the Drizzle-compatible literal type when reading from Zod-validated data: use 'as \"GET\" | \"POST\" | \"PUT\" | \"PATCH\" | \"DELETE\"' on the method field, or narrow the local data type in both the POST and PATCH handlers"
human_verification:
  - test: "Verify Brave Search returns real results end-to-end"
    expected: "Agent with web_search task returns formatted search results"
    why_human: "Requires a live BRAVE_API_KEY and a running Schedoodle instance — cannot be verified by grep or unit tests"
  - test: "Verify webhook tool calls an external endpoint during agent execution"
    expected: "Custom webhook tool attached to an agent makes an outbound HTTP POST and the result appears in the execution log"
    why_human: "Requires a live external target and a running Schedoodle instance"
---

# Phase 9: Agent Tool Use Verification Report

**Phase Goal:** Agents can use built-in tools (web_fetch, web_search) and custom webhook tools during LLM execution, with tool call logging and configurable timeouts
**Verified:** 2026-03-15T03:45:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | tools table exists in DB with all required columns | VERIFIED | `src/db/schema.ts` lines 46-60: id, name, description, url, method (enum), headers (json), inputSchema (json), createdAt, updatedAt |
| 2 | agent_tools join table exists with cascade deletes and unique constraint | VERIFIED | `src/db/schema.ts` lines 62-74: both onDelete cascade references + uniqueIndex on (agentId, toolId) |
| 3 | agents table has maxExecutionMs nullable column | VERIFIED | `src/db/schema.ts` line 20: `maxExecutionMs: integer("max_execution_ms")` with no default (nullable) |
| 4 | executionHistory has toolCalls JSON column | VERIFIED | `src/db/schema.ts` line 41: `toolCalls: text("tool_calls", { mode: "json" })` |
| 5 | BRAVE_API_KEY is an optional env var in config | VERIFIED | `src/config/env.ts` line 16: `BRAVE_API_KEY: z.string().optional()` |
| 6 | web_fetch tool fetches URL, converts HTML to plain text, handles errors gracefully | VERIFIED | `src/services/tools/web-fetch.ts`: imports convert from html-to-text, uses wordwrap 120, returns error string on catch |
| 7 | web_search queries Brave Search API with graceful fallback when unconfigured | VERIFIED | `src/services/tools/web-search.ts`: checks env.BRAVE_API_KEY, returns appropriate error strings |
| 8 | Webhook tool factory converts DB tool record into AI SDK tool() instance | VERIFIED | `src/services/tools/webhook.ts`: createWebhookTool returns object with description, jsonSchema inputSchema, and execute |
| 9 | Tool registry combines built-in + custom tools into a single toolSet | VERIFIED | `src/services/tools/registry.ts`: buildToolSet returns { web_fetch, web_search, ...custom_prefixed } |
| 10 | executeAgent passes tools + stopWhen: stepCountIs(10) to generateText | VERIFIED | `src/services/executor.ts` line 115: `stopWhen: hasTools ? stepCountIs(10) : undefined` |
| 11 | Circuit breaker wraps entire generateText call including all tool steps | VERIFIED | `src/services/executor.ts` line 188: `await llmBreaker.execute(() => callLlmWithRetry(...))` — entire multi-step function wrapped |
| 12 | Per-agent execution timeout enforced via AbortController | VERIFIED | `src/services/executor.ts` lines 156-158: AbortController with `agent.maxExecutionMs ?? 60_000`, clearTimeout in finally |
| 13 | Tool call details logged as JSON array in execution history | VERIFIED | `src/services/executor.ts` line 222: `toolCalls: toolCallLog.length > 0 ? toolCallLog : null` stored to DB |
| 14 | Token usage uses result.totalUsage when available | VERIFIED | `src/services/executor.ts` line 203: `const usage = result.totalUsage ?? result.usage` |
| 15 | User can CRUD custom tools via /tools API | VERIFIED | `src/routes/tools.ts`: POST, GET, GET/:id, PATCH/:id, DELETE/:id all implemented |
| 16 | User can attach/detach/list tools on an agent | VERIFIED | `src/routes/agents.ts` lines 291-368: GET/POST/DELETE /:id/tools all implemented |
| 17 | /tools routes mounted in application | VERIFIED | `src/index.ts` line 45: `app.route("/tools", createToolRoutes(db))` |
| 18 | TypeScript compiles without errors | FAILED | `pnpm tsc --noEmit` reports 2 errors in src/routes/tools.ts: method field typed as string incompatible with Drizzle's enum literal type requirement |
| 19 | Full test suite passes | VERIFIED | 326/326 tests pass across 21 test files |

**Score:** 18/19 truths verified (1 failed: TypeScript compilation)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/schema.ts` | tools, agentTools tables; maxExecutionMs; toolCalls | VERIFIED | All 4 additions present, correct types |
| `src/config/env.ts` | BRAVE_API_KEY optional env var | VERIFIED | Line 16 |
| `src/services/tools/web-fetch.ts` | webFetchTool AI SDK tool | VERIFIED | Exports webFetchTool, 31 lines, substantive |
| `src/services/tools/web-search.ts` | webSearchTool AI SDK tool | VERIFIED | Exports webSearchTool, 59 lines, substantive |
| `src/services/tools/webhook.ts` | createWebhookTool factory | VERIFIED | Exports createWebhookTool, 34 lines, substantive |
| `src/services/tools/registry.ts` | buildToolSet combining all tools | VERIFIED | Exports buildToolSet, 22 lines, substantive |
| `src/schemas/tool-input.ts` | createToolSchema, updateToolSchema | VERIFIED | Both exported, 15 lines |
| `src/types/index.ts` | Tool, NewTool, AgentTool types | VERIFIED | Lines 7-9 export all three |
| `src/services/executor.ts` | Modified with tool support | VERIFIED | Imports buildToolSet, stepCountIs, agentTools, tools; all wired |
| `src/routes/tools.ts` | CRUD routes for /tools | VERIFIED (with TS issue) | Routes functional (tests pass), but 2 TypeScript type errors present |
| `src/routes/agents.ts` | Tool attachment endpoints | VERIFIED | GET/POST/DELETE /:id/tools all present |
| `src/index.ts` | Mounts /tools routes | VERIFIED | Line 45 |
| `tests/tools-web-fetch.test.ts` | web_fetch tests | VERIFIED | 14 test declarations, all pass |
| `tests/tools-web-search.test.ts` | web_search tests | VERIFIED | 21 test declarations, all pass |
| `tests/tools-webhook.test.ts` | webhook tests | VERIFIED | 15 test declarations, all pass |
| `tests/tools-registry.test.ts` | registry tests | VERIFIED | 9 test declarations, all pass |
| `tests/routes-tools.test.ts` | tools CRUD API tests | VERIFIED | 59 test declarations, all pass |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/services/tools/web-fetch.ts` | html-to-text convert() | `import { convert } from "html-to-text"` | WIRED | Line 2 import, line 23 usage with wordwrap: 120 |
| `src/services/tools/web-search.ts` | env.BRAVE_API_KEY | `import { env } from "../../config/env.js"` | WIRED | Line 3 import, line 22 usage |
| `src/services/tools/webhook.ts` | ai jsonSchema() | `import { jsonSchema } from "ai"` | WIRED | Line 1 import, line 11 usage |
| `src/services/tools/registry.ts` | webFetchTool + webSearchTool + createWebhookTool | sibling module imports | WIRED | Lines 3-5 imports, lines 12-13 and 18 usage |
| `src/services/executor.ts` | src/services/tools/registry.ts | `import { buildToolSet } from "./tools/registry.js"` | WIRED | Line 14 import, line 184 usage |
| `src/services/executor.ts` | stepCountIs from ai | `import { stepCountIs } from "ai"` | WIRED | Line 1 import, line 115 usage |
| `src/services/executor.ts` | executionHistory.toolCalls | toolCalls field in DB update | WIRED | Line 222: `toolCalls: toolCallLog.length > 0 ? toolCallLog : null` |
| `src/routes/tools.ts` | src/db/schema.ts tools table | `import { tools } from "../db/schema.js"` | WIRED | Line 5 import, used in all route handlers |
| `src/routes/agents.ts` | src/db/schema.ts agentTools | `import { agents, agentTools, tools } from "../db/schema.js"` | WIRED | Line 5 import, agentTools used in all 3 attachment routes |
| `src/index.ts` | src/routes/tools.ts | `app.route('/tools', createToolRoutes(db))` | WIRED | Lines 13 and 45 |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TOOL-01 | 09-01 | web_fetch built-in tool fetches URL content, HTML to plain text | SATISFIED | `src/services/tools/web-fetch.ts`: html-to-text convert() used, error handling present |
| TOOL-02 | 09-01 | web_search built-in tool queries Brave Search API | SATISFIED | `src/services/tools/web-search.ts`: Brave API call with structured result formatting |
| TOOL-03 | 09-01 | Custom webhook tools execute HTTP calls with configurable URL/method/headers/schema | SATISFIED | `src/services/tools/webhook.ts`: createWebhookTool uses toolDef.url/method/headers/inputSchema |
| TOOL-04 | 09-03 | Full CRUD API at /tools | SATISFIED | `src/routes/tools.ts`: POST/GET/GET:id/PATCH:id/DELETE:id all present and tested |
| TOOL-05 | 09-03 | Many-to-many agent-tool attachment via join table with link/unlink API | SATISFIED | `src/routes/agents.ts`: POST/DELETE/GET /:id/tools:toolId all present |
| TOOL-06 | 09-02 | Executor uses generateText with tools + stopWhen: stepCountIs(10) | SATISFIED | `src/services/executor.ts` line 115 |
| TOOL-07 | 09-02 | Tool call details logged as JSON array in execution history | SATISFIED | `src/services/executor.ts` onStepFinish callback collects toolName/input/output/durationMs, stored at line 222 |
| TOOL-08 | 09-02 | Per-agent configurable execution timeout via maxExecutionMs + AbortController | SATISFIED | `src/services/executor.ts` lines 156-158 and 308-309 (finally clearTimeout) |
| TOOL-09 | 09-01 | Database schema: tools table, agent_tools join table, maxExecutionMs, toolCalls | SATISFIED | `src/db/schema.ts`: all 4 additions verified |
| TOOL-10 | 09-01 | Built-in tools automatically available to all agents | SATISFIED | `registry.ts` always includes web_fetch/web_search in toolSet regardless of customTools input |
| TOOL-11 | 09-02 | Circuit breaker wraps entire generateText call including all tool steps | SATISFIED | `src/services/executor.ts` line 188: llmBreaker.execute wraps entire callLlmWithRetry |

All 11 TOOL requirements are covered. No orphaned requirements found.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/routes/tools.ts` | 44-51 | `c.req.valid("json" as never) as { method?: string; ... }` — explicit `string` type on `method` widens the Drizzle-required enum | Warning | Causes 2 TypeScript compile errors; routes still function at runtime (tests pass) but `pnpm tsc --noEmit` fails |

No TODO/FIXME/placeholder comments or empty implementations found in any phase 9 source file.

---

## Human Verification Required

### 1. Live Brave Search Integration

**Test:** Set `BRAVE_API_KEY` in environment, create an agent with a task that requires searching (e.g., "Search for today's top tech news"), run the agent.
**Expected:** Execution completes with tool call log showing a web_search call, and the agent's result incorporates search results.
**Why human:** Requires a live Brave API key and a running Schedoodle server; unit tests mock the fetch call.

### 2. Webhook Tool Live Execution

**Test:** Create a custom tool via `POST /tools` pointing to `https://httpbin.org/post`, attach it to an agent via `POST /agents/:id/tools/:toolId`, run the agent with a task instructing it to call that tool.
**Expected:** Execution history shows a toolCalls entry with the webhook's toolName, input, and response text.
**Why human:** Requires a live outbound HTTP target and an agent task that actually triggers the tool call.

---

## Gaps Summary

One gap blocks a clean certification: **TypeScript compilation failure in `src/routes/tools.ts`**.

The `method` field on lines 61 and 117 is typed as `string` (from the Zod validator's `c.req.valid("json" as never)` cast), but Drizzle's `tools` table insert and update operations require the literal enum type `"GET" | "POST" | "PUT" | "PATCH" | "DELETE"`. This causes `pnpm tsc --noEmit` to exit with code 2.

The runtime behavior is unaffected (all 326 tests pass), but the phase success criterion "Schema changes compile: pnpm tsc --noEmit" is not met. The fix is straightforward: narrow the `method` field type in both the POST and PATCH local data casts to the enum literal union.

---

_Verified: 2026-03-15T03:45:00Z_
_Verifier: Claude (gsd-verifier)_
