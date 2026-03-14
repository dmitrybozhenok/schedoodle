# Phase 6: Agent Enabled Flag and Schedule Controls - Research

**Researched:** 2026-03-14
**Domain:** Agent lifecycle management (enable/disable toggle, schedule metadata)
**Confidence:** HIGH

## Summary

This phase adds an `enabled` boolean flag to agents and enriches API responses with computed schedule metadata (`nextRunAt`, `lastRunAt`). The scope is well-bounded: one new DB column, scheduler modifications to respect the flag, API changes for filtering and toggling, and computed fields derived from croner's `nextRun()` and the existing `execution_history` table.

All required libraries are already in the project. Croner v10 provides `nextRun()` on Cron instances. Drizzle ORM handles the schema migration via `db:push`. The existing scheduler architecture (Map-based job registry, `scheduleAgent`/`removeAgent` functions) maps directly to enable/disable semantics. No new dependencies are needed.

**Primary recommendation:** Implement as a single plan with three waves: (1) schema + migration, (2) scheduler enable/disable logic, (3) API changes with computed fields.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Disabled agents do NOT have cron jobs registered -- silent skip, no log noise
- Disabled agents CAN still be manually executed via POST /:id/execute
- Toggle is a boolean `enabled` field on the agents table
- New agents default to enabled (matches current behavior)
- Enable/disable via PATCH /agents/:id { enabled: true/false } -- no dedicated endpoints
- Add computed `nextRunAt` field to agent responses (from croner's nextRun())
- Add computed `lastRunAt` field to agent responses (latest execution_history row)
- `nextRunAt` returns null for disabled agents -- unambiguous signal that agent won't run
- Both fields included in GET /agents list and GET /agents/:id detail responses
- GET /agents supports ?enabled=true or ?enabled=false query param for filtering
- `enabled` field accepted in POST /agents create body (optional, defaults to true)
- PATCH response returns updated agent with enabled status and nextRunAt/lastRunAt -- no extra status message
- Standard flat JSON response pattern maintained
- ALTER TABLE adds `enabled` column with DEFAULT 1 (true) -- all existing agents continue running
- At startup, only enabled agents are loaded into the scheduler (WHERE enabled = 1)
- Startup log shows both counts: "[cron] Scheduled 3 agent(s), 2 disabled"
- PATCH { enabled: true } immediately registers the cron job
- PATCH { enabled: false } immediately removes the cron job

### Claude's Discretion
- How lastRunAt is computed (subquery vs join vs separate query)
- Croner API usage for nextRun() computation
- Migration approach (Drizzle push vs manual ALTER TABLE)
- Test strategy for scheduler enable/disable behavior

### Deferred Ideas (OUT OF SCOPE)
- Pause-until-date (auto-re-enable at future time) -- separate feature, adds timer complexity
- Run-once mode -- different scheduling paradigm, not in scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGNT-05 | User can enable/disable an agent without deleting it | `enabled` integer column on agents table, PATCH toggle, scheduler integration, startup filtering |
</phase_requirements>

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| croner | ^10.0.1 | Cron scheduling + `nextRun()` computation | Already used; `nextRun()` returns Date or null |
| drizzle-orm | ^0.45.1 | DB schema, queries, migration via `db:push` | Already used for all DB operations |
| zod | ^4.3.6 | Input validation schemas | Already used for all validation |
| hono | ^4.12.8 | HTTP routing, query params | Already used for all routes |
| better-sqlite3 | ^12.8.0 | SQLite database | Already used as DB driver |
| vitest | ^4.1.0 | Testing | Already used for all tests |

### Supporting
No new libraries needed for this phase.

### Alternatives Considered
None -- all tooling is already in the project.

## Architecture Patterns

### Schema Change

Add `enabled` integer column to the agents table in `src/db/schema.ts`:

```typescript
// In agents table definition, add:
enabled: integer("enabled").notNull().default(1),
```

SQLite uses integer 0/1 for booleans. Drizzle maps this correctly. The `default(1)` ensures existing rows get `enabled = 1` when `db:push` runs ALTER TABLE.

**Migration approach recommendation:** Use `pnpm db:push` (Drizzle Kit push). This is the established pattern for this project -- no manual SQL migrations. Drizzle Kit will generate `ALTER TABLE agents ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`.

### Computed Fields Pattern

`nextRunAt` and `lastRunAt` are NOT stored in the database -- they are computed at query time and added to the response. This avoids stale data.

**nextRunAt computation:**
```typescript
import { Cron } from "croner";

function getNextRunAt(agent: { cronSchedule: string; enabled: number }): string | null {
  if (!agent.enabled) return null;
  const job = new Cron(agent.cronSchedule, { paused: true });
  const next = job.nextRun();
  job.stop();
  return next ? next.toISOString() : null;
}
```

Key: Create a temporary paused Cron instance just for the `nextRun()` calculation. Call `stop()` after to avoid resource leaks. The `paused: true` option prevents it from actually scheduling.

**lastRunAt computation (recommendation: subquery):**
```typescript
import { desc, eq, and } from "drizzle-orm";

// For a single agent:
const lastExec = db
  .select({ startedAt: executionHistory.startedAt })
  .from(executionHistory)
  .where(eq(executionHistory.agentId, agentId))
  .orderBy(desc(executionHistory.startedAt))
  .limit(1)
  .get();

const lastRunAt = lastExec?.startedAt ?? null;
```

For the list endpoint, use a separate query per agent or a grouped subquery. Given typical agent counts (< 100), N+1 queries are acceptable. For a cleaner approach, use a SQL subquery:

```typescript
import { sql } from "drizzle-orm";

// In the list query, add a subquery for lastRunAt:
const lastRunAtSubquery = db
  .select({
    agentId: executionHistory.agentId,
    lastRunAt: sql<string>`MAX(${executionHistory.startedAt})`.as("last_run_at"),
  })
  .from(executionHistory)
  .groupBy(executionHistory.agentId)
  .as("last_runs");
```

**Recommendation:** Use a single SQL query with LEFT JOIN on a subquery for the list endpoint (efficient, one DB round-trip). Use a simple separate query for the detail endpoint (simpler code, single agent).

### Response Enrichment Pattern

Create a helper function that takes a raw agent row and returns the enriched response:

```typescript
function enrichAgent(agent: Agent, db: Database): AgentResponse {
  return {
    ...agent,
    enabled: Boolean(agent.enabled), // Convert 0/1 to true/false for JSON
    nextRunAt: getNextRunAt(agent),
    lastRunAt: getLastRunAt(agent.id, db),
  };
}
```

This keeps the enrichment logic in one place, reusable across GET list, GET detail, POST create, and PATCH update handlers.

### Scheduler Enable/Disable Logic

The PATCH handler already has the pattern for conditional rescheduling:

```typescript
// Current pattern (cron change):
if (data.cronSchedule !== undefined) {
  scheduleAgent(updated, db);
}

// New pattern (enabled change + cron change):
if (data.enabled !== undefined || data.cronSchedule !== undefined) {
  if (updated.enabled) {
    scheduleAgent(updated, db);  // registers or re-registers
  } else {
    removeAgent(updated.id);     // removes if exists
  }
}
```

### Startup Modification

In `src/index.ts`, filter the startup query:

```typescript
import { eq } from "drizzle-orm";

const allAgents = db.select().from(agents).all();
const enabledAgents = allAgents.filter(a => a.enabled);
const disabledCount = allAgents.length - enabledAgents.length;
startAll(enabledAgents, db);
// Log already handled by startAll, but modify to show disabled count
```

Better: modify `startAll` to accept total count or modify the startup log in `index.ts` directly. The CONTEXT.md specifies the format: `"[cron] Scheduled 3 agent(s), 2 disabled"`.

### Query Param Filtering

In the GET /agents list handler:

```typescript
app.get("/", (c) => {
  const enabledParam = c.req.query("enabled");

  let query = db.select().from(agents);

  if (enabledParam === "true") {
    query = query.where(eq(agents.enabled, 1));
  } else if (enabledParam === "false") {
    query = query.where(eq(agents.enabled, 0));
  }

  const list = query.all();
  // Enrich with computed fields
  return c.json(list.map(a => enrichAgent(a, db)));
});
```

### Anti-Patterns to Avoid
- **Storing nextRunAt in the database:** It becomes stale immediately. Compute on read.
- **Boolean type in SQLite schema:** SQLite has no native boolean. Use `integer()` with 0/1. Drizzle does not auto-convert; handle in the response enrichment.
- **Creating Cron instance without stopping it:** Every `new Cron(expr, { paused: true })` must be followed by `.stop()` to avoid memory leaks, even though it is paused.
- **Forgetting to update test SQL:** The test files use raw `CREATE TABLE` SQL strings, not the Drizzle schema. When adding `enabled` to the schema, the test SQL must also be updated.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Next cron execution time | Date arithmetic on cron expressions | `new Cron(expr, { paused: true }).nextRun()` | Cron expression parsing is complex; croner handles all edge cases |
| Schema migration | Manual SQL scripts | `pnpm db:push` (Drizzle Kit) | Established project pattern; handles ALTER TABLE correctly |
| Boolean JSON conversion | Manual 0/1 mapping everywhere | Single `enrichAgent()` helper | Centralizes the conversion, avoids inconsistency |

## Common Pitfalls

### Pitfall 1: Test SQL Out of Sync
**What goes wrong:** Tests use hardcoded `CREATE TABLE` SQL strings. Adding a column to `schema.ts` without updating the test SQL causes runtime errors in tests.
**Why it happens:** The test files define their own SQL for in-memory databases, separate from the Drizzle schema.
**How to avoid:** Update `CREATE_AGENTS_SQL` in both `tests/scheduler.test.ts` and `tests/routes-agents.test.ts` to include `enabled INTEGER NOT NULL DEFAULT 1`.
**Warning signs:** Tests fail with "table agents has no column named enabled" errors.

### Pitfall 2: Croner Memory Leak
**What goes wrong:** Creating Cron instances for `nextRun()` without stopping them accumulates timers.
**Why it happens:** Even paused Cron instances may hold internal references.
**How to avoid:** Always call `.stop()` on temporary Cron instances used for computation.
**Warning signs:** Increasing memory usage on list endpoints.

### Pitfall 3: SQLite Integer vs JSON Boolean
**What goes wrong:** API returns `enabled: 1` instead of `enabled: true` in JSON responses.
**Why it happens:** SQLite stores booleans as integers; Drizzle returns the raw integer.
**How to avoid:** Convert in the `enrichAgent()` helper: `enabled: Boolean(agent.enabled)` or `enabled: agent.enabled === 1`.
**Warning signs:** API consumers receive 0/1 instead of true/false.

### Pitfall 4: PATCH Enable Without Rescheduling
**What goes wrong:** Setting `enabled: true` via PATCH doesn't start the cron job.
**Why it happens:** Current PATCH handler only reschedules on `cronSchedule` changes, not `enabled` changes.
**How to avoid:** Extend the PATCH handler condition to check for `enabled` changes too.
**Warning signs:** Agent shows as enabled but doesn't run on schedule until server restart.

### Pitfall 5: Enabled Field in Zod Schema Without Boolean Coercion
**What goes wrong:** Zod rejects `enabled: true` because the DB column is integer.
**Why it happens:** Schema expects boolean from API but needs integer for DB.
**How to avoid:** Accept `z.boolean().optional()` in the input schema, convert to integer before DB insert/update.
**Warning signs:** 400 validation errors when sending `{ "enabled": true }`.

## Code Examples

### Adding enabled to Drizzle schema
```typescript
// src/db/schema.ts - agents table, add after model field:
enabled: integer("enabled").notNull().default(1),
```

### Adding enabled to Zod input schemas
```typescript
// src/schemas/agent-input.ts
export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  taskDescription: z.string().min(1),
  cronSchedule: cronExpression,
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  enabled: z.boolean().optional(),  // defaults handled at DB level
});
```

### Croner nextRun() usage
```typescript
// Verified from croner type definitions (croner.d.ts)
// nextRun(prev?: CronDate | Date | string | null): Date | null
const cron = new Cron("0 * * * *", { paused: true });
const next: Date | null = cron.nextRun();
cron.stop();
// next is null if no future run exists (shouldn't happen with valid cron)
```

### Drizzle conditional where clause
```typescript
import { eq } from "drizzle-orm";

// Build query conditionally:
const enabledParam = c.req.query("enabled");
let baseQuery = db.select().from(agents);
if (enabledParam === "true") {
  baseQuery = baseQuery.where(eq(agents.enabled, 1)) as typeof baseQuery;
} else if (enabledParam === "false") {
  baseQuery = baseQuery.where(eq(agents.enabled, 0)) as typeof baseQuery;
}
const list = baseQuery.all();
```

### Updated test CREATE TABLE SQL
```sql
CREATE TABLE agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  task_description TEXT NOT NULL,
  cron_schedule TEXT NOT NULL,
  system_prompt TEXT,
  model TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE UNIQUE INDEX agents_name_nocase ON agents(name COLLATE NOCASE);
```

## State of the Art

No changes since v1 -- all libraries are at the same versions used throughout the project. This phase uses existing APIs only (croner `nextRun()`, Drizzle schema additions, Hono query params).

## Open Questions

1. **Type safety for enriched agent response**
   - What we know: The `Agent` type is inferred from the Drizzle schema (`typeof agents.$inferSelect`). Adding `nextRunAt` and `lastRunAt` creates a new response shape.
   - What's unclear: Whether to define a formal `AgentResponse` type or use inline spread.
   - Recommendation: Define an `AgentResponse` type that extends `Agent` with `{ enabled: boolean; nextRunAt: string | null; lastRunAt: string | null }`. This gives type safety in route handlers.

2. **Drizzle conditional where typing**
   - What we know: Drizzle's query builder may not chain `.where()` seamlessly with TypeScript when conditionally applied.
   - What's unclear: Whether a type assertion is needed.
   - Recommendation: Use a conditional variable or ternary for the where clause. May need `as typeof baseQuery` cast.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGNT-05a | enabled column defaults to 1 for new agents | unit | `pnpm vitest run tests/routes-agents.test.ts -t "enabled"` | Will update existing |
| AGNT-05b | PATCH enabled:false removes cron job | unit | `pnpm vitest run tests/scheduler.test.ts -t "enabled"` | Will update existing |
| AGNT-05c | PATCH enabled:true registers cron job | unit | `pnpm vitest run tests/scheduler.test.ts -t "enabled"` | Will update existing |
| AGNT-05d | Disabled agent excluded from startup scheduling | unit | `pnpm vitest run tests/scheduler.test.ts -t "disabled"` | Will update existing |
| AGNT-05e | Disabled agent can be manually executed | unit | `pnpm vitest run tests/routes-agents.test.ts -t "execute"` | Will update existing |
| AGNT-05f | GET /agents?enabled=true filters correctly | unit | `pnpm vitest run tests/routes-agents.test.ts -t "filter"` | Will update existing |
| AGNT-05g | nextRunAt computed from croner, null when disabled | unit | `pnpm vitest run tests/routes-agents.test.ts -t "nextRunAt"` | Will update existing |
| AGNT-05h | lastRunAt from latest execution_history row | unit | `pnpm vitest run tests/routes-agents.test.ts -t "lastRunAt"` | Will update existing |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] Update `CREATE_AGENTS_SQL` in `tests/scheduler.test.ts` -- add `enabled INTEGER NOT NULL DEFAULT 1`
- [ ] Update `CREATE_AGENTS_SQL` in `tests/routes-agents.test.ts` -- add `enabled INTEGER NOT NULL DEFAULT 1`
- [ ] Update `makeAgent` helper in both test files to accept `enabled` override

## Sources

### Primary (HIGH confidence)
- Source code inspection: `src/db/schema.ts`, `src/services/scheduler.ts`, `src/routes/agents.ts`, `src/schemas/agent-input.ts`, `src/index.ts`
- croner type definitions: `node_modules/croner/dist/croner.d.ts` -- confirmed `nextRun()` signature
- Existing test files: `tests/scheduler.test.ts`, `tests/routes-agents.test.ts` -- confirmed patterns

### Secondary (MEDIUM confidence)
- Drizzle ORM conditional query building -- based on existing usage patterns in the codebase

### Tertiary (LOW confidence)
- None -- all findings verified from source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in project, APIs verified from type definitions
- Architecture: HIGH - direct extension of existing patterns (scheduler, routes, schema)
- Pitfalls: HIGH - identified from concrete code inspection (test SQL, integer booleans, Cron lifecycle)

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable -- no external dependency changes expected)
