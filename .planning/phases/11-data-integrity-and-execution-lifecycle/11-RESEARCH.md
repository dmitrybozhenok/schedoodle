# Phase 11: Data Integrity and Execution Lifecycle - Research

**Researched:** 2026-03-15
**Domain:** SQLite data integrity, execution lifecycle management, Drizzle ORM indexes
**Confidence:** HIGH

## Summary

Phase 11 hardens the existing Schedoodle database layer and execution lifecycle. The work spans five areas: (1) adding indexes to `execution_history` for query performance, (2) stale execution cleanup on startup, (3) age-based history pruning on startup, (4) fixing `updatedAt` tracking on tools PATCH handler, and (5) restricting the existing manual execution endpoint to enabled agents only.

Most of this phase involves straightforward application-level changes with no new dependencies. The database already has WAL mode and foreign key enforcement enabled (verified in `src/db/index.ts` lines 16-19). The manual execution endpoint already exists (added in Phase 9, `src/routes/agents.ts` line 240). The `updatedAt` fix for agents PATCH is already in place (line 196). Only the tools PATCH handler and the 409-for-disabled-agents guard are missing.

**Primary recommendation:** Focus implementation on three areas: (1) Drizzle schema index additions + `db:push`, (2) a new startup module for stale cleanup and pruning, (3) small route-level fixes for the execute endpoint and tools PATCH handler.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- On startup, mark all 'running' records as 'failure' with error 'Process terminated during execution'
- Set completedAt to process start time; leave durationMs null (can't know actual duration)
- Console log the count: '[startup] Cleaned up N stale running executions'
- No periodic cleanup -- startup-only is sufficient for a single-process architecture
- Age-based pruning: delete execution_history records older than N days
- Default retention: 30 days, configurable via RETENTION_DAYS env var (optional, in env.ts)
- Run pruning on startup (after stale cleanup)
- Console log: '[startup] Pruned N execution records older than 30 days'
- Enable PRAGMA foreign_keys = ON on every database connection
- Enable PRAGMA journal_mode = WAL for concurrent read/write performance
- Add indexes on execution_history: agent_id (FK lookups), composite agent_id+startedAt (history queries), status (stale cleanup)
- Fix updatedAt on agents table: set updatedAt = new Date().toISOString() in PATCH handler (application code, not trigger)
- Also fix updatedAt on tools table PATCH handler (same pattern)
- POST /agents/:id/execute -- triggers immediate execution of an agent
- Returns result inline (waits for completion, may take 10-60s)
- Only enabled agents can be manually executed (return 409 if disabled)
- Sends notifications same as scheduled execution (consistent behavior)

### Claude's Discretion
- Exact startup function orchestration (order of stale cleanup -> pruning -> scheduler start)
- Index naming conventions
- Whether to add PRAGMA pragmas via better-sqlite3 connection options or manual exec
- Error response format for 409 on disabled agent execute

### Deferred Ideas (OUT OF SCOPE)
- SCHD-03 (catch-up on missed schedules) -- decided against for now
- EXEC-07 (dry-run mode) -- skipped, manual execute is sufficient
- Periodic pruning (daily cron) -- startup-only for now, add if needed
- EXEC-06 (per-agent Zod output schemas) -- still v2
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXEC-05 | User can trigger any agent manually via API without waiting for schedule | Manual execute endpoint already exists; needs 409 guard for disabled agents |
| (Integrity) | FK enforcement and WAL mode on every connection | Already implemented in src/db/index.ts; verified |
| (Integrity) | Indexes on execution_history for performance | Drizzle schema index additions via index() function |
| (Lifecycle) | Stale execution cleanup on startup | New startup module with UPDATE query |
| (Lifecycle) | History retention pruning on startup | New startup module with DELETE query |
| (Fix) | updatedAt tracking on agents and tools PATCH | Agents already fixed; tools PATCH needs updatedAt |
</phase_requirements>

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.45.1 | Schema definitions, queries, index declarations | Already in use; index() for new indexes |
| drizzle-kit | ^0.31.9 | Schema push to DB | `db:push` applies schema changes including new indexes |
| better-sqlite3 | ^12.8.0 | SQLite driver | Synchronous operations for startup tasks |
| zod | ^4.3.6 | Env validation | RETENTION_DAYS env var with coerce + default |

### No New Dependencies
This phase requires zero new packages. All work uses existing libraries.

## Architecture Patterns

### Recommended Project Structure Changes
```
src/
  config/
    env.ts              # Add RETENTION_DAYS optional env var
  db/
    index.ts            # PRAGMAs already in place (no changes needed)
    schema.ts           # Add index() declarations on executionHistory
  services/
    startup.ts          # NEW: stale cleanup + history pruning functions
  routes/
    agents.ts           # Add 409 guard on POST /:id/execute for disabled agents
    tools.ts            # updatedAt already set -- VERIFY (confirmed set on line 119)
  index.ts              # Import and call startup tasks before scheduler start
```

### Pattern 1: Startup Task Module
**What:** A dedicated `src/services/startup.ts` module exporting pure functions that take `db` and perform startup operations.
**When to use:** Initialization logic that must run before the scheduler starts.
**Example:**
```typescript
// src/services/startup.ts
import { eq, lt } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { executionHistory } from "../db/schema.js";

export function cleanupStaleExecutions(db: Database): number {
  const now = new Date().toISOString();
  const result = db
    .update(executionHistory)
    .set({
      status: "failure",
      error: "Process terminated during execution",
      completedAt: now,
    })
    .where(eq(executionHistory.status, "running"))
    .run();
  return result.changes;
}

export function pruneOldExecutions(db: Database, retentionDays: number): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db
    .delete(executionHistory)
    .where(lt(executionHistory.startedAt, cutoff))
    .run();
  return result.changes;
}
```

### Pattern 2: Drizzle Index Declaration (Array Syntax)
**What:** Add indexes to executionHistory table using the array-based third parameter.
**When to use:** Schema changes for query performance.
**Example:**
```typescript
// In src/db/schema.ts
import { index } from "drizzle-orm/sqlite-core";

export const executionHistory = sqliteTable("execution_history", {
  // ... existing columns ...
}, (table) => [
  index("idx_exec_agent_id").on(table.agentId),
  index("idx_exec_agent_started").on(table.agentId, table.startedAt),
  index("idx_exec_status").on(table.status),
]);
```

### Pattern 3: Env Var with Coerce + Default
**What:** Optional numeric env var with default value using Zod.
**When to use:** Configurable settings with sensible defaults.
**Example:**
```typescript
RETENTION_DAYS: z.coerce.number().default(30),
```

### Anti-Patterns to Avoid
- **Trigger-based updatedAt:** The user explicitly decided against SQL triggers for updatedAt; use application code `new Date().toISOString()` in PATCH handlers instead.
- **Periodic pruning cron:** Explicitly deferred. Startup-only pruning is the current design.
- **Async startup tasks:** The stale cleanup and pruning are synchronous DB operations via better-sqlite3. Do not use async patterns or promises for these.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date arithmetic for pruning cutoff | Complex date parsing | `new Date(Date.now() - days * 86400000).toISOString()` | Standard JS Date is sufficient for day-level granularity |
| Index management | Raw SQL CREATE INDEX | Drizzle `index()` in schema + `db:push` | Keeps schema as single source of truth |
| PRAGMA management | Manual raw SQL per connection | `db.$client.pragma()` (already done) | better-sqlite3's .pragma() method is idiomatic |

## Common Pitfalls

### Pitfall 1: Index Addition Breaks db:push on Existing Data
**What goes wrong:** Adding indexes to a table that already has data can cause `drizzle-kit push` to attempt a table rebuild (copy data to new table with indexes, drop old, rename).
**Why it happens:** SQLite cannot add indexes to existing tables without CREATE INDEX; Drizzle may try to recreate the table.
**How to avoid:** Plain indexes (not unique) on existing tables should work fine with `drizzle-kit push` since they just issue CREATE INDEX statements. Verify by running `db:push` in development first. If it tries to recreate the table, fall back to raw `CREATE INDEX IF NOT EXISTS` in the startup module.
**Warning signs:** `drizzle-kit push` prompts about table recreation or data loss.

### Pitfall 2: Stale Cleanup Must Run Before Scheduler
**What goes wrong:** If the scheduler starts before stale cleanup, it might read stale 'running' records and misinterpret health status.
**Why it happens:** Boot sequence ordering matters.
**How to avoid:** Call `cleanupStaleExecutions()` and `pruneOldExecutions()` before `startAll()` in `src/index.ts`.
**Warning signs:** Health endpoint shows stale 'running' executions after restart.

### Pitfall 3: RETENTION_DAYS Edge Cases
**What goes wrong:** Setting RETENTION_DAYS to 0 or negative values could delete all history or cause errors.
**Why it happens:** No validation on the env var beyond coerce.
**How to avoid:** Add `.min(1)` to the Zod schema for RETENTION_DAYS, or at least document the minimum. A value of 0 would delete everything, which is probably not intended.
**Warning signs:** All execution history disappears after startup.

### Pitfall 4: Existing Manual Execute Tests Expect Disabled Agent Success
**What goes wrong:** The existing test at `tests/routes-agents.test.ts` line 721-733 tests "POST /:id/execute works on disabled agent" and expects success. Adding the 409 guard will break this test.
**Why it happens:** The endpoint was added without the enabled check (Phase 9 implementation).
**How to avoid:** Update the existing test to expect 409 for disabled agents, and add a new test for enabled agents succeeding.
**Warning signs:** Test failures after adding the guard.

### Pitfall 5: Tools PATCH updatedAt -- Already Present
**What goes wrong:** Spending time "fixing" something that already works.
**Why it happens:** The CONTEXT.md mentions fixing updatedAt on tools PATCH, but examining `src/routes/tools.ts` line 115-123 shows it already sets `updatedAt: new Date().toISOString()` in the PATCH handler.
**How to avoid:** Verify before implementing. The tools PATCH updatedAt is already correctly set. The "fix" may refer to ensuring consistency, which is already in place.
**Warning signs:** None -- this is already correct.

## Code Examples

### Stale Execution Cleanup Query
```typescript
// Source: Drizzle ORM eq() filter + .run() for synchronous execution
import { eq } from "drizzle-orm";

const now = new Date().toISOString();
const result = db
  .update(executionHistory)
  .set({
    status: "failure",
    error: "Process terminated during execution",
    completedAt: now,
    // durationMs intentionally left null per user decision
  })
  .where(eq(executionHistory.status, "running"))
  .run();
// result.changes gives the count of affected rows
console.log(`[startup] Cleaned up ${result.changes} stale running executions`);
```

### History Pruning Query
```typescript
// Source: Drizzle ORM lt() for date comparison
import { lt } from "drizzle-orm";

const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
const result = db
  .delete(executionHistory)
  .where(lt(executionHistory.startedAt, cutoffDate))
  .run();
console.log(`[startup] Pruned ${result.changes} execution records older than ${retentionDays} days`);
```

### 409 Guard for Disabled Agent Execute
```typescript
// In POST /:id/execute handler
if (agent.enabled === 0) {
  return c.json({ error: "Agent is disabled", message: "Enable the agent before triggering manual execution" }, 409);
}
```

### Index Declarations in Schema
```typescript
// Source: https://orm.drizzle.team/docs/indexes-constraints
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const executionHistory = sqliteTable("execution_history", {
  // ... existing columns unchanged ...
}, (table) => [
  index("idx_exec_agent_id").on(table.agentId),
  index("idx_exec_agent_started").on(table.agentId, table.startedAt),
  index("idx_exec_status").on(table.status),
]);
```

### Boot Sequence in index.ts
```typescript
// src/index.ts -- modified boot sequence
import { cleanupStaleExecutions, pruneOldExecutions } from "./services/startup.js";
import { env } from "./config/env.js";

// Boot sequence: cleanup -> pruning -> scheduler
const staleCount = cleanupStaleExecutions(db);
if (staleCount > 0) {
  console.log(`[startup] Cleaned up ${staleCount} stale running executions`);
}

const prunedCount = pruneOldExecutions(db, env.RETENTION_DAYS);
if (prunedCount > 0) {
  console.log(`[startup] Pruned ${prunedCount} execution records older than ${env.RETENTION_DAYS} days`);
}

const allAgents = db.select().from(agents).all();
startAll(allAgents, db);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Object-based 3rd param in sqliteTable | Array-based 3rd param | Drizzle 0.36+ | Project already uses array syntax |
| No PRAGMAs set | WAL + foreign_keys ON | Already in codebase | No change needed |
| No manual execute | POST /:id/execute exists | Phase 9 | Only needs 409 guard addition |

**Already implemented (no changes needed):**
- `PRAGMA journal_mode = WAL` -- already in `src/db/index.ts` line 16
- `PRAGMA foreign_keys = ON` -- already in `src/db/index.ts` line 19
- `updatedAt` on agents PATCH -- already in `src/routes/agents.ts` line 196
- `updatedAt` on tools PATCH -- already in `src/routes/tools.ts` line 119
- Manual execute endpoint structure -- already in `src/routes/agents.ts` line 240

## Open Questions

1. **db:push behavior with new indexes on existing data**
   - What we know: Adding plain (non-unique) indexes should result in simple CREATE INDEX statements
   - What's unclear: Whether drizzle-kit 0.31.9 will attempt table recreation for the executionHistory table that currently has no third parameter
   - Recommendation: Test `db:push` in development; if it tries to recreate the table, add indexes via raw SQL in the startup module as a fallback

2. **Log output format -- conditional vs unconditional**
   - What we know: CONTEXT.md shows unconditional logging pattern: `[startup] Cleaned up N stale running executions`
   - What's unclear: Whether to log when N=0 (no stale records)
   - Recommendation: Log unconditionally per CONTEXT.md wording; the count of 0 is still informative

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXEC-05-guard | 409 for disabled agent manual execute | unit | `pnpm vitest run tests/routes-agents.test.ts -t "409"` | Needs update (existing test expects success) |
| STARTUP-01 | Stale running records marked as failure on startup | unit | `pnpm vitest run tests/startup.test.ts` | Wave 0 |
| STARTUP-02 | History pruning deletes old records | unit | `pnpm vitest run tests/startup.test.ts` | Wave 0 |
| INDEX-01 | Indexes exist on execution_history table | unit | `pnpm vitest run tests/db.test.ts -t "index"` | Wave 0 |
| ENV-01 | RETENTION_DAYS env var parsed with default 30 | unit | `pnpm vitest run tests/config.test.ts -t "RETENTION"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/startup.test.ts` -- covers stale cleanup and pruning logic
- [ ] Update `tests/routes-agents.test.ts` -- change disabled agent execute test from expect-success to expect-409
- [ ] Update `tests/db.test.ts` -- add index existence verification tests
- [ ] Update `tests/config.test.ts` -- add RETENTION_DAYS env var tests

## Sources

### Primary (HIGH confidence)
- Project source code: `src/db/index.ts`, `src/db/schema.ts`, `src/routes/agents.ts`, `src/routes/tools.ts`, `src/services/executor.ts`, `src/index.ts`, `src/config/env.ts` -- direct inspection
- [Drizzle ORM Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints) -- index() syntax, composite index patterns
- [Drizzle Kit Push](https://orm.drizzle.team/docs/drizzle-kit-push) -- db:push behavior for schema changes

### Secondary (MEDIUM confidence)
- [SQLite PRAGMA documentation](https://sqlite.org/pragma.html) -- foreign_keys and journal_mode semantics
- [better-sqlite3 pragma API](https://www.npmjs.com/package/better-sqlite3) -- .pragma() method

### Tertiary (LOW confidence)
- None -- all findings verified against source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all patterns verified in codebase
- Architecture: HIGH -- startup module pattern is straightforward, all integration points identified
- Pitfalls: HIGH -- verified existing code state, identified test that needs updating
- Indexes: MEDIUM -- index addition via db:push may need fallback to raw SQL (untested with this specific schema)

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable domain, no fast-moving dependencies)
