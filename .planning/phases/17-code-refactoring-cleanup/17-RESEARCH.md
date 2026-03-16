# Phase 17: Code Refactoring, Cleanup - Research

**Researched:** 2026-03-16
**Domain:** Internal code quality -- module decomposition, deduplication, configuration centralization, logger utility
**Confidence:** HIGH

## Summary

Phase 17 is a pure internal refactoring phase with no new features, no API changes, and no external behavior changes. The codebase is a TypeScript/Hono/Drizzle service (~16 completed phases, 38 test files, 12 service modules). The primary target is `executor.ts` (382 lines, 7+ responsibilities) which needs decomposition into focused modules. Secondary targets are: extracting duplicated `zodErrorHook` and `parseId` from 3 route files into shared helpers, creating a lightweight console-based logger to replace 32 scattered console.log/error/warn calls across 8 source files, and centralizing ~12 hardcoded operational constants into a single constants file.

The codebase has well-established patterns that guide this refactoring: factory functions for routes with DI, module-level singletons with `_reset*()` test helpers, fire-and-forget notification via `Promise.allSettled`, and the existing `src/helpers/` and `src/config/` directory structures. The existing test suite (38 files, 1,214 lines in executor.test.ts alone) provides a safety net but must be restructured to match new module boundaries.

**Primary recommendation:** Decompose executor.ts into three focused modules (orchestrator, recorder, notification dispatch), extract shared route utilities, centralize constants, and add a logger -- all while preserving the existing public API surface and keeping tests green after every step.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Full decomposition of executor.ts (382 lines) into focused modules:
  - ExecutionOrchestrator -- coordinates the execution flow (semaphore, timeout, abort)
  - ExecutionRecorder -- persists execution results to DB (insert running, update success/failure)
  - Notification dispatch logic moves into notifier.ts (eliminates ~100 lines of duplication between success/failure paths)
- The existing executeAgent / executeAgentInner entry points should be preserved as the public API
- Extract all duplicated route utilities into `src/helpers/validation.ts`:
  - `zodErrorHook` (currently duplicated in agents.ts, schedules.ts, tools.ts)
  - `parseId` helper
  - Any other repeated route patterns discovered during implementation
- Route files should import from the shared module instead of defining locally
- Create a lightweight logger wrapper (no new dependencies) in a new file
- Standardize the existing [cron], [startup], [shutdown], [notify], [concurrency] prefixes
- Expose log levels (info, warn, error) for consistency
- Still console-based -- easy to swap for Pino later if needed
- Replace all 32 console.log/error/warn calls across src/
- Move all hardcoded operational constants to `src/config/constants.ts`
- Constants to centralize:
  - Rate limiter: LLM_MAX_REQUESTS (10), GENERAL_MAX_REQUESTS (60), WINDOW_MS (60000)
  - Circuit breaker: FAILURE_THRESHOLD (3), RESET_TIMEOUT_MS (30000)
  - Prefetch: FETCH_TIMEOUT_MS (10000), MAX_RESPONSE_BYTES (1048576)
  - Executor: DEFAULT_EXECUTION_TIMEOUT_MS (60000)
  - Semaphore: default from MAX_CONCURRENT_LLM env var
- NOT env-configurable -- just a single source of truth file. Values stay the same.
- All REST API response shapes, status codes, and error formats stay IDENTICAL
- This is strictly internal refactoring -- no downstream breakage
- Health endpoint response shape unchanged
- MCP server stays independent -- don't refactor MCP in this phase
- Keep services/ directory flat (no sub-directories) -- 10 files is manageable
- Keep manage.ts and dashboard.ts with inline HTML -- intentional design, not worth extracting
- New files from decomposition stay in services/ alongside existing files

### Claude's Discretion
- Exact naming of decomposed executor modules
- Whether to keep circuit-breaker and semaphore imports in the orchestrator or pass them as dependencies
- How to structure the logger API (function-based vs object-based)
- Whether parseId warrants inclusion in helpers/validation.ts or stays inline

### Deferred Ideas (OUT OF SCOPE)
- Structured JSON logging with Pino -- future phase if production deployment needed
- MCP server refactoring / shared service layer -- separate concern
- Pagination on list endpoints -- feature addition, not refactoring
- N+1 query optimization in health endpoint -- performance phase
- Per-model circuit breaker (currently per-provider) -- resilience enhancement
</user_constraints>

## Architecture Patterns

### Current Project Structure (Relevant Directories)
```
src/
  config/
    env.ts            # Zod-validated env vars (pattern: export const env = loadEnv())
    llm-provider.ts   # Model resolution
    pricing.ts        # Static lookup table (pattern for constants.ts)
  helpers/
    cron-detect.ts    # Focused utility module
    enrich-agent.ts   # DB-dependent helper with multiple exports
  middleware/
    auth.ts
    rate-limiter.ts   # Has hardcoded constants to extract
    security.ts
  routes/
    agents.ts         # 380 lines, has zodErrorHook + parseId duplicates
    health.ts         # Has its own truncate() helper
    schedules.ts      # Has zodErrorHook duplicate
    tools.ts          # Has zodErrorHook + parseId duplicates
    dashboard.ts      # Inline HTML, leave alone
    manage.ts         # Inline HTML, leave alone
  services/
    circuit-breaker.ts  # Has hardcoded constants to extract
    executor.ts         # PRIMARY TARGET: 382 lines, 7+ responsibilities
    notifier.ts         # 295 lines, receives notification dispatch from executor
    prefetch.ts         # Has hardcoded constants to extract
    scheduler.ts        # 105 lines, imports executeAgent
    semaphore.ts        # 47 lines, clean module
    startup.ts          # 38 lines, clean module
    telegram.ts
    telegram-commands.ts  # 290 lines, imports executeAgent + getLlmCircuitStatus
    telegram-poller.ts    # 121 lines, has 1 console.error
    intent-parser.ts
    tools/              # Sub-directory (registry.ts etc.)
  mcp/
    tools/agents.ts     # Imports executeAgent
    tools/health.ts     # Imports getLlmCircuitStatus, getLlmSemaphoreStatus
    helpers.ts
  index.ts              # 148 lines, 10 console calls, imports from executor
```

### Pattern 1: Executor Decomposition Strategy

**What:** Split executor.ts into three focused modules while preserving public API.

**Current executor.ts responsibilities (382 lines):**
1. Circuit breaker singleton management (lines 22-38)
2. Semaphore singleton management (lines 41-62)
3. Type definitions (ExecuteResult, ExecuteSuccess, ExecuteFailure) (lines 64-76)
4. Circuit status getter (lines 82-84)
5. LLM call with retry logic (lines 107-161)
6. DB recording (insert running, update success/failure) (lines 168-176, 227-240, 297-307)
7. Notification dispatch with parallel channels (lines 243-281, 310-347)
8. Execution orchestration (prefetch, tool loading, timing, error handling) (lines 166-353)
9. Semaphore-wrapped public entry point (lines 359-372)
10. Batch execution helper (lines 377-382)

**Recommended decomposition:**

```
executor.ts (FACADE -- preserved public API, ~80 lines)
  Imports from orchestrator, re-exports: executeAgent, executeAgentInner, executeAgents
  Keeps: circuit breaker + semaphore singletons, status getters, reset/drain helpers
  Reason: All external consumers (index.ts, scheduler.ts, telegram-commands.ts,
          MCP tools, routes/agents.ts, tests) import from executor.ts --
          keeping it as the public surface means ZERO import path changes

execution-orchestrator.ts (NEW -- ~120 lines)
  Receives: circuit breaker + semaphore as parameters (DI)
  Contains: callLlmWithRetry, executeAgentCore (the inner logic), type definitions
  Coordinates: prefetch, tool loading, LLM call, delegates to recorder + notification

execution-recorder.ts (NEW -- ~60 lines)
  Contains: insertRunningRecord, updateSuccess, updateFailure
  Pure DB operations extracted from executeAgentInner

notifier.ts (MODIFIED -- gains ~80 lines of dispatch logic)
  Gains: dispatchNotifications(type, agentName, executionId, db, payload)
  Eliminates: the ~100 lines of duplicated success/failure notification dispatch in executor.ts
  The two parallel dispatch blocks (lines 243-281 and 310-347) are nearly identical
```

**Why this structure:**
- executor.ts as facade means zero import changes across 7 consumer files
- The orchestrator receives dependencies via parameters (testable, no module-level singletons in the logic layer)
- Notification dispatch consolidation eliminates genuine duplication (two nearly identical 40-line blocks)
- DB recording is pure data persistence, naturally separable

### Pattern 2: Shared Route Utilities Extraction

**What:** Extract `zodErrorHook` and `parseId` from route files into `src/helpers/validation.ts`.

**Current duplication:**
- `zodErrorHook` defined identically in: agents.ts (line 31), schedules.ts (line 10), tools.ts (line 11)
- `parseId` defined identically in: agents.ts (line 51), tools.ts (line 31)

**Extracted shape:**
```typescript
// src/helpers/validation.ts

/**
 * Zod validation error hook for route handlers.
 * Maps Zod issues to { field, message } details array.
 */
export function zodErrorHook(
  result: {
    success: boolean;
    error?: { issues: Array<{ path: (string | number)[]; message: string }> };
  },
  c: { json: (data: unknown, status: number) => Response },
): Response | undefined {
  if (!result.success) {
    const details = result.error?.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    return c.json({ error: "Validation failed", details }, 400);
  }
}

/**
 * Parse and validate an integer ID from URL parameter.
 * Returns the numeric ID or null if invalid.
 */
export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isNaN(id) || !Number.isInteger(id) ? null : id;
}
```

**Impact:** Three route files updated to import from `src/helpers/validation.ts`. All three test files (routes-agents.test.ts, routes-schedules.test.ts, routes-tools.test.ts) should continue to pass without changes since the behavior is identical.

### Pattern 3: Logger Utility Design

**Recommendation: Object-based logger with prefix methods.**

**Why object-based over function-based:**
- `logger.info("[cron] Executing: ...")` reads naturally
- Groups all log functions under one namespace
- Easy to mock in tests (single import)
- Pattern matches how Pino would work if upgraded later

**Current console call inventory (32 calls across 8 files):**

| File | log | error | warn | Prefixes |
|------|-----|-------|------|----------|
| index.ts | 8 | 1 | 0 | [startup], [telegram-bot], [shutdown], (none) |
| executor.ts | 1 | 2 | 0 | [concurrency], [notify] |
| scheduler.ts | 4 | 1 | 1 | [cron] |
| notifier.ts | 0 | 8 | 0 | [notify] |
| telegram-poller.ts | 0 | 1 | 0 | [telegram-bot] |
| telegram-commands.ts | 0 | 1 | 0 | [telegram-bot] |
| config/env.ts | 0 | 1 | 0 | Config error |
| mcp.ts | 0 | 2 | 0 | [mcp] |

**Design:**
```typescript
// src/helpers/logger.ts

type LogLevel = "info" | "warn" | "error";

function formatMessage(level: LogLevel, prefix: string, message: string): string {
  return `[${prefix}] ${message}`;
}

function createLogger(prefix: string) {
  return {
    info: (message: string) => console.log(formatMessage("info", prefix, message)),
    warn: (message: string) => console.warn(formatMessage("warn", prefix, message)),
    error: (message: string) => console.error(formatMessage("error", prefix, message)),
  };
}

// Pre-built loggers for established prefixes
export const log = {
  cron: createLogger("cron"),
  startup: createLogger("startup"),
  shutdown: createLogger("shutdown"),
  notify: createLogger("notify"),
  concurrency: createLogger("concurrency"),
  telegram: createLogger("telegram-bot"),
  mcp: createLogger("mcp"),
  // Generic for one-off messages
  info: (message: string) => console.log(message),
  warn: (message: string) => console.warn(message),
  error: (message: string) => console.error(message),
};
```

**Note on env.ts and mcp.ts:** The `env.ts` console.error call happens during startup before any module loads -- it should be left as-is (or use a minimal wrapper) since it fires before the logger module would be available. The `mcp.ts` calls use `console.error` (stderr) intentionally for MCP stdio protocol compliance -- leave these as-is per the "MCP stays independent" constraint.

### Pattern 4: Constants Centralization

**What:** Move hardcoded operational constants to `src/config/constants.ts`.

**Current locations and values:**

| Constant | Current Location | Value |
|----------|-----------------|-------|
| `WINDOW_MS` | rate-limiter.ts:3 | 60_000 |
| `LLM_MAX_REQUESTS` | rate-limiter.ts:4 | 10 |
| `GENERAL_MAX_REQUESTS` | rate-limiter.ts:5 | 60 |
| `CLEANUP_INTERVAL_MS` | rate-limiter.ts:6 | 300_000 |
| `STALE_THRESHOLD_MS` | rate-limiter.ts:7 | 120_000 |
| `failureThreshold` | executor.ts:26,36 | 3 |
| `resetTimeoutMs` | executor.ts:27,37 | 30_000 |
| `FETCH_TIMEOUT_MS` | prefetch.ts:65 (inline `AbortSignal.timeout(10_000)`) | 10_000 |
| `MAX_RESPONSE_BYTES` | prefetch.ts:7 | 1_048_576 |
| `DEFAULT_EXECUTION_TIMEOUT_MS` | executor.ts:181 (inline `60_000`) | 60_000 |
| `TELEGRAM_MAX_LENGTH` | notifier.ts:171 | 3_800 |
| `MAX_CONCURRENT_LLM` | executor.ts:41 (from env) | env.MAX_CONCURRENT_LLM |

**File design (following pricing.ts pattern):**
```typescript
// src/config/constants.ts

// --- Rate Limiter ---
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_LLM_MAX = 10;
export const RATE_LIMIT_GENERAL_MAX = 60;
export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 300_000;
export const RATE_LIMIT_STALE_THRESHOLD_MS = 120_000;

// --- Circuit Breaker ---
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
export const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 30_000;

// --- Prefetch ---
export const PREFETCH_TIMEOUT_MS = 10_000;
export const PREFETCH_MAX_RESPONSE_BYTES = 1_048_576;

// --- Executor ---
export const DEFAULT_EXECUTION_TIMEOUT_MS = 60_000;

// --- Notifications ---
export const TELEGRAM_MAX_MESSAGE_LENGTH = 3_800;
```

**Note:** `MAX_CONCURRENT_LLM` stays in env.ts because it IS env-configurable. The constants file is for static operational defaults only.

### Anti-Patterns to Avoid

- **Changing import paths for external consumers:** executor.ts MUST remain the public API surface. The orchestrator/recorder are internal implementation details.
- **Breaking the notification fire-and-forget pattern:** Notification errors must NEVER affect execution status. The consolidated dispatch function must preserve the try/catch isolation.
- **Splitting tests before splitting code:** Always split source first, verify tests pass with old structure, THEN split tests to match. Never do both simultaneously.
- **Changing API response shapes:** This phase explicitly locks all REST API shapes. No field additions, removals, or renames.
- **Over-abstracting the logger:** No log levels filtering, no file output, no structured JSON. Console.log/warn/error with prefix standardization only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Logging | Custom log transport/sink system | Thin console wrapper | Pino deferred; this is just prefix standardization |
| Test restructuring | Manual test migration | Copy-then-modify approach | Preserves test coverage during transition |

**Key insight:** This phase is about reducing complexity, not adding abstractions. Every new file should be simpler than what it replaces.

## Common Pitfalls

### Pitfall 1: Circular Dependencies After Decomposition
**What goes wrong:** Splitting executor.ts into multiple modules that import each other creates circular dependency chains (e.g., orchestrator imports recorder, recorder imports types from orchestrator).
**Why it happens:** Types and helpers are currently co-located in one file.
**How to avoid:** Define shared types (ExecuteResult, ExecuteSuccess, ExecuteFailure, ToolCallLogEntry) in a separate types file OR at the top of executor.ts (the facade). All decomposed modules import types from the facade, never from each other.
**Warning signs:** TypeScript compilation errors mentioning "cannot access before initialization" or runtime `undefined` imports.

### Pitfall 2: Breaking Notification Status DB Updates
**What goes wrong:** Moving notification dispatch to notifier.ts but forgetting the DB status update logic (set pending, dispatch, derive per-channel status, update DB).
**Why it happens:** The notification dispatch in executor.ts is tightly coupled to DB updates -- it's not just "send notification" but a complex workflow of: set pending -> dispatch -> derive status -> update DB.
**How to avoid:** The consolidated dispatch function in notifier.ts must accept the `db` and `executionId` parameters and handle the complete workflow. Test by verifying `emailDeliveryStatus` and `telegramDeliveryStatus` columns are correctly set for all scenarios (sent, skipped, failed).
**Warning signs:** Delivery status columns stuck at "pending" or always "failed" after refactoring.

### Pitfall 3: Test Mocking After Module Split
**What goes wrong:** executor.test.ts (1,214 lines) mocks `../src/services/notifier.js`, `../src/services/prefetch.js`, etc. After decomposition, the mock paths may be wrong or mocks may not intercept correctly.
**Why it happens:** Vitest's `vi.mock()` operates on module paths. If orchestrator.ts imports notifier.ts differently than executor.ts did, mocks need updating.
**How to avoid:** Since executor.ts remains the facade that tests import from, and the executor.ts facade imports the orchestrator internally, the existing test mocks should work IF the orchestrator uses the same import paths as before. Verify by running the full test suite after each decomposition step.
**Warning signs:** Tests that previously passed start getting real LLM calls or real DB writes.

### Pitfall 4: Logger Side Effects in Tests
**What goes wrong:** Introducing the logger module in tests causes noisy output or, worse, tests that depend on console.log output break.
**Why it happens:** Some tests may spy on console.log to verify logging behavior.
**How to avoid:** Check if any existing tests spy on console.log/error/warn. If so, update the spy to target the logger's underlying console call (or mock the logger module directly). The logger's thin wrapper design makes this straightforward.
**Warning signs:** Tests that check `console.log` calls fail or produce unexpected output.

### Pitfall 5: Constants Import Order
**What goes wrong:** Importing from `src/config/constants.ts` in modules that are loaded early (like env.ts) creates module initialization ordering issues.
**Why it happens:** `constants.ts` is a static file with no dependencies, so it should be safe -- but if accidentally given a dependency on env.ts, circular initialization occurs.
**How to avoid:** `constants.ts` must have ZERO imports. It is a pure static data file (like pricing.ts).
**Warning signs:** `undefined` values at runtime for constants.

## Code Examples

### Notification Dispatch Consolidation

The two notification blocks in executor.ts (success path lines 243-281, failure path lines 310-347) share identical structure. Consolidated version:

```typescript
// In notifier.ts (addition)

import { eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { executionHistory } from "../db/schema.js";

type NotificationPayload =
  | { type: "success"; agentName: string; executedAt: string; output: AgentOutput }
  | { type: "failure"; agentName: string; executedAt: string; errorMsg: string };

export async function dispatchNotifications(
  payload: NotificationPayload,
  executionId: number,
  db: Database,
): Promise<void> {
  try {
    // Set both channels to pending
    db.update(executionHistory)
      .set({ emailDeliveryStatus: "pending", telegramDeliveryStatus: "pending" })
      .where(eq(executionHistory.id, executionId))
      .run();

    // Dispatch both channels in parallel
    const [emailResult, telegramResult] = await Promise.allSettled(
      payload.type === "success"
        ? [
            sendNotification(payload.agentName, payload.executedAt, payload.output),
            sendTelegramNotification(payload.agentName, payload.executedAt, payload.output),
          ]
        : [
            sendFailureNotification(payload.agentName, payload.executedAt, payload.errorMsg),
            sendTelegramFailureNotification(payload.agentName, payload.executedAt, payload.errorMsg),
          ],
    );

    // Derive per-channel status
    const deriveStatus = (result: PromiseSettledResult<NotifyResult>) => {
      const status = result.status === "fulfilled" ? result.value : { status: "failed" as const };
      return status.status === "skipped" ? null : status.status === "sent" ? "sent" : "failed";
    };

    db.update(executionHistory)
      .set({
        emailDeliveryStatus: deriveStatus(emailResult),
        telegramDeliveryStatus: deriveStatus(telegramResult),
      })
      .where(eq(executionHistory.id, executionId))
      .run();
  } catch (err) {
    log.notify.error(`Unexpected error: ${err}`);
    db.update(executionHistory)
      .set({ emailDeliveryStatus: "failed", telegramDeliveryStatus: "failed" })
      .where(eq(executionHistory.id, executionId))
      .run();
  }
}
```

### Re-export Facade Pattern (executor.ts after refactoring)

```typescript
// src/services/executor.ts -- becomes thin facade
import { env } from "../config/env.js";
import type { Database } from "../db/index.js";
import { CIRCUIT_BREAKER_FAILURE_THRESHOLD, CIRCUIT_BREAKER_RESET_TIMEOUT_MS } from "../config/constants.js";
import type { Agent } from "../types/index.js";
import { createCircuitBreaker } from "./circuit-breaker.js";
import { executeAgentCore, type ExecuteResult } from "./execution-orchestrator.js";
import { createSemaphore, type SemaphoreStatus } from "./semaphore.js";
import { log } from "../helpers/logger.js";

// Re-export types for consumers
export type { ExecuteResult } from "./execution-orchestrator.js";

const BREAKER_NAME = env.LLM_PROVIDER === "ollama" ? "ollama" : "anthropic";

let llmBreaker = createCircuitBreaker({
  name: BREAKER_NAME,
  failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  resetTimeoutMs: CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
});

export function _resetLlmBreaker() { /* same as now */ }

let llmSemaphore = createSemaphore(env.MAX_CONCURRENT_LLM);

export function getLlmSemaphoreStatus(): SemaphoreStatus { return llmSemaphore.getStatus(); }
export function drainLlmSemaphore(): number { return llmSemaphore.drain(); }
export function _resetLlmSemaphore(): void { llmSemaphore = createSemaphore(env.MAX_CONCURRENT_LLM); }
export function getLlmCircuitStatus() { return llmBreaker.getStatus(); }

export async function executeAgentInner(agent: Agent, db: Database): Promise<ExecuteResult> {
  return executeAgentCore(agent, db, llmBreaker);
}

export async function executeAgent(agent: Agent, db: Database): Promise<ExecuteResult> {
  const status = llmSemaphore.getStatus();
  if (status.active >= status.limit) {
    log.concurrency.info(`Slot full (${status.active}/${status.limit} active), agent "${agent.name}" queued`);
  }
  await llmSemaphore.acquire();
  try {
    return await executeAgentInner(agent, db);
  } finally {
    llmSemaphore.release();
  }
}

export async function executeAgents(agents: Agent[], db: Database) {
  return Promise.allSettled(agents.map((a) => executeAgent(a, db)));
}
```

## Import Dependency Map (Executor Consumers)

All of these import from `src/services/executor.ts` -- NONE should need path changes:

| Consumer | Imports |
|----------|---------|
| src/index.ts | `drainLlmSemaphore`, `getLlmCircuitStatus`, `getLlmSemaphoreStatus` |
| src/services/scheduler.ts | `executeAgent` |
| src/services/telegram-commands.ts | `executeAgent`, `getLlmCircuitStatus` |
| src/routes/agents.ts | `executeAgent` |
| src/mcp/tools/agents.ts | `executeAgent` |
| src/mcp/tools/health.ts | `getLlmCircuitStatus`, `getLlmSemaphoreStatus` |
| tests/executor.test.ts | `_resetLlmBreaker`, `_resetLlmSemaphore`, `drainLlmSemaphore`, `executeAgent`, `executeAgents`, `getLlmSemaphoreStatus` |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Test Files Impacted by Refactoring
| File | Lines | Impact | Action |
|------|-------|--------|--------|
| tests/executor.test.ts | 1,214 | HIGH -- primary decomposition target | Split after source decomposition |
| tests/notifier.test.ts | 490 | MEDIUM -- notification dispatch moves here | Add tests for dispatchNotifications |
| tests/routes-agents.test.ts | ? | LOW -- import path unchanged | Verify passing |
| tests/routes-schedules.test.ts | ? | LOW -- import path unchanged | Verify passing |
| tests/routes-tools.test.ts | ? | LOW -- import path unchanged | Verify passing |
| tests/circuit-breaker.test.ts | ? | LOW -- constants change only | Verify passing |
| tests/middleware-rate-limiter.test.ts | ? | LOW -- constants change only | Verify passing |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test && pnpm typecheck && pnpm lint`
- **Phase gate:** Full suite green before marking complete

### Wave 0 Gaps
- [ ] `tests/execution-orchestrator.test.ts` -- covers extracted orchestration logic
- [ ] `tests/execution-recorder.test.ts` -- covers extracted DB recording logic
- [ ] Existing executor.test.ts logic will be redistributed to new test files

## Open Questions

1. **Should executor.test.ts be split or adapted in place?**
   - What we know: executor.test.ts (1,214 lines) tests the combined behavior. Since executor.ts remains the facade, all tests could remain in executor.test.ts and continue to pass.
   - What's unclear: Whether splitting test files to match module boundaries adds value given the facade pattern.
   - Recommendation: Keep executor.test.ts testing the public API (facade). Add new test files for execution-orchestrator.ts and execution-recorder.ts only if they have distinct testable behaviors beyond what the facade tests cover. The CONTEXT.md says "test files split to match new module boundaries" so split them.

2. **Logger placement: src/helpers/ or src/config/?**
   - What we know: Loggers are infrastructure, helpers are business logic helpers. The existing pattern has env.ts and pricing.ts in config/.
   - Recommendation: Place in `src/helpers/logger.ts` since it's a utility used by all layers (services, routes, index.ts), similar to how validation.ts serves routes. Config is for configuration data, not utilities.

3. **env.ts and mcp.ts console calls**
   - What we know: env.ts console.error fires during startup config validation and is followed by process.exit(1). mcp.ts uses console.error for MCP stdio protocol.
   - Recommendation: Leave env.ts as-is (it runs before logger is importable, and the exit makes it moot). Leave mcp.ts as-is per the "MCP stays independent" constraint. This means 30 of 32 calls get replaced, 2 remain.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all 12 source files in src/services/
- Direct codebase analysis of all 4 route files in src/routes/
- Direct codebase analysis of all 3 config files in src/config/
- Direct codebase analysis of all 2 helper files in src/helpers/
- Direct codebase analysis of src/index.ts and src/mcp.ts
- grep analysis: 32 console.log/error/warn calls across 8 source files (verified)
- Executor line count: 382 lines (verified via wc -l)
- Test file count: 38 test files in tests/ directory
- executor.test.ts: 1,214 lines, notifier.test.ts: 490 lines (verified)

### Secondary (MEDIUM confidence)
- Pattern inference from existing codebase conventions (factory functions, DI, _reset helpers)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all changes are internal restructuring
- Architecture: HIGH - based on direct analysis of every file that will be modified or impacted
- Pitfalls: HIGH - derived from actual import graphs and module dependency analysis
- Code examples: HIGH - adapted directly from existing codebase patterns

**Research date:** 2026-03-16
**Valid until:** No expiration (internal refactoring, no external dependency concerns)
