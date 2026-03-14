# Phase 3: Management API and Scheduling - Research

**Researched:** 2026-03-14
**Domain:** REST API (Hono), cron scheduling (croner), Zod validation
**Confidence:** HIGH

## Summary

This phase adds an HTTP REST API for agent CRUD operations and an in-process cron scheduler that automatically executes agents on their schedules. The existing codebase already has the database schema (agents, executionHistory), the executor service (executeAgent), and Zod-based validation patterns. The new code needs: Hono HTTP server with Zod-validated routes, croner-based scheduler with lifecycle management, and an updated index.ts that boots both.

The stack is well-established: Hono is the dominant lightweight TypeScript HTTP framework, croner is the modern zero-dependency cron library with TypeScript types, and @hono/zod-validator provides the bridge between Hono routing and Zod schemas (with Zod v4 support confirmed).

**Primary recommendation:** Use Hono + @hono/node-server for HTTP, croner for scheduling, @hono/zod-validator for request validation. Keep all scheduling state in-memory with immediate re-sync on CRUD mutations.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use Hono as the HTTP framework -- lightweight, TypeScript-native, ESM-friendly
- All agent CRUD routes in a single file: src/routes/agents.ts, mounted on the Hono app
- Request bodies validated with Zod schemas (consistent with project's Zod-everywhere approach)
- Port 3000 by default, overridable via PORT env var (add to Zod env schema with default)
- In-process cron library -- runs inside the same Node.js process
- Load all agents from DB at startup and register their cron schedules
- When an agent is created/updated/deleted via API, update the in-memory schedule immediately
- Log cron triggers and results to console
- Single process: API server and scheduler both start in index.ts
- Flat JSON responses, no envelope -- success returns the resource directly, lists return arrays
- Error format: { error: string, details?: [{ field, message }] }
- Standard REST status codes: 400 (validation), 404 (not found), 409 (duplicate name), 500 (unexpected)
- Field-level validation error details from Zod error paths
- Separate GET /agents/:id/executions endpoint for execution history per agent
- Validate cron expressions on create/update -- reject invalid expressions with 400
- On update (PATCH): reschedule the cron job immediately when schedule changes
- On delete: cancel the cron job, delete the agent row, keep execution history (no cascade)
- Support PATCH with partial fields for updates (don't require resending unchanged fields)

### Claude's Discretion
- Specific cron library choice (node-cron vs croner vs other)
- Hono middleware patterns (error handler, logger)
- Execution history pagination/limit strategy
- How to handle the foreign key constraint when deleting agents (nullable FK or ON DELETE SET NULL)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGNT-01 | User can create an agent with name, task description, and cron schedule via API | Hono POST route + zValidator for body validation + Drizzle insert |
| AGNT-02 | User can read, update, and delete agents via API | Hono GET/PATCH/DELETE routes + Drizzle select/update/delete |
| AGNT-03 | Each agent can have an optional system prompt that shapes behavior | Already in DB schema as nullable `system_prompt`; include in create/update Zod schemas |
| SCHD-01 | Agents run automatically according to their cron schedule | Croner in-process scheduler loading agents at startup, calling executeAgent |
| SCHD-02 | Multiple agents can be scheduled concurrently without conflicts | Croner runs each job independently; executeAgent already handles concurrent execution via Promise.allSettled pattern |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hono | ^4.12 | HTTP framework | Lightweight, TypeScript-native, Web Standards based, ESM-friendly |
| @hono/node-server | ^1.19 | Node.js adapter for Hono | Official adapter, provides `serve()` function |
| @hono/zod-validator | ^0.7 | Zod validation middleware | Official Hono middleware, supports Zod v4, type-safe validated data |
| croner | ^10.0 | Cron scheduling | Zero dependencies, TypeScript types, stop/pause/resume, expression validation, timezone support |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | ^4.3.6 | Request body schemas | Already in project; reuse for API input validation |
| drizzle-orm | ^0.45.1 | Database queries | Already in project; CRUD operations on agents/executionHistory |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| croner | node-cron | node-cron lacks nextRun(), has no TypeScript types, no stop/resume API |
| croner | cron (kelektiv) | Larger dependency tree, less modern API |
| @hono/zod-validator | Manual validation | Loses type inference on c.req.valid(), more boilerplate |

**Recommendation (Claude's Discretion -- cron library):** Use **croner**. It is zero-dependency, has built-in TypeScript types, provides stop()/pause()/resume() methods essential for lifecycle management, and validates expressions at construction time (throwing on invalid patterns). node-cron lacks these features.

**Installation:**
```bash
pnpm add hono @hono/node-server @hono/zod-validator croner
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  config/
    env.ts              # Add PORT with default 3000
  db/
    schema.ts           # Existing -- agents, executionHistory (modify FK)
    index.ts            # Existing -- db export
  routes/
    agents.ts           # NEW -- all CRUD + executions endpoint
  services/
    executor.ts         # Existing -- executeAgent
    scheduler.ts        # NEW -- croner lifecycle manager
  schemas/
    agent-input.ts      # NEW -- Zod schemas for create/update request bodies
    agent-output.ts     # Existing -- LLM output schema
  types/
    index.ts            # Existing -- Agent, Execution types
  index.ts              # MODIFIED -- Hono app + scheduler init
```

### Pattern 1: Hono App with Error Handler
**What:** Global error handler that converts all errors to the flat JSON format.
**When to use:** Always -- ensures consistent error responses.
**Example:**
```typescript
// src/index.ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { serve } from "@hono/node-server";
import { env } from "./config/env.js";
import agentRoutes from "./routes/agents.js";

const app = new Hono();

// Global error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("Unexpected error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// Not found handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Mount routes
app.route("/agents", agentRoutes);

// Start server + scheduler
serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Schedoodle listening on port ${info.port}`);
});
```

### Pattern 2: Zod-Validated Route with Custom Error Hook
**What:** Use @hono/zod-validator with a custom error callback that formats Zod errors into the { error, details } shape.
**When to use:** Every route that accepts a request body.
**Example:**
```typescript
// src/routes/agents.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ZodError } from "zod";

// Shared error hook for all validators
function zodErrorHook(result: { success: false; error: ZodError }, c: any) {
  const details = result.error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
  return c.json({ error: "Validation failed", details }, 400);
}

const createAgentSchema = z.object({
  name: z.string().min(1),
  taskDescription: z.string().min(1),
  cronSchedule: z.string().min(1),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
});

const agents = new Hono();

agents.post(
  "/",
  zValidator("json", createAgentSchema, zodErrorHook),
  async (c) => {
    const data = c.req.valid("json");
    // ... insert into DB, register cron
    return c.json(agent, 201);
  }
);
```

### Pattern 3: Scheduler Service with Map-Based Job Registry
**What:** A scheduler module that maintains a Map<number, Cron> for all active jobs, with start/add/update/remove methods.
**When to use:** The single scheduler instance managing all agent cron jobs.
**Example:**
```typescript
// src/services/scheduler.ts
import { Cron } from "croner";
import { executeAgent } from "./executor.js";
import type { Agent } from "../types/index.js";
import type { Database } from "../db/index.js";

const jobs = new Map<number, Cron>();

export function scheduleAgent(agent: Agent, db: Database): void {
  // Remove existing job if any
  removeAgent(agent.id);

  const job = new Cron(agent.cronSchedule, { name: `agent-${agent.id}` }, async () => {
    console.log(`[cron] Executing: ${agent.name}`);
    const start = Date.now();
    const result = await executeAgent(agent, db);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[cron] ${agent.name}: ${result.status} in ${elapsed}s`);
  });

  jobs.set(agent.id, job);
}

export function removeAgent(agentId: number): void {
  const existing = jobs.get(agentId);
  if (existing) {
    existing.stop();
    jobs.delete(agentId);
  }
}

export function startAll(agents: Agent[], db: Database): void {
  for (const agent of agents) {
    scheduleAgent(agent, db);
  }
  console.log(`[cron] Scheduled ${agents.length} agent(s)`);
}

export function stopAll(): void {
  for (const [id, job] of jobs) {
    job.stop();
  }
  jobs.clear();
}
```

### Pattern 4: Cron Expression Validation in Zod Schema
**What:** Custom Zod refinement that validates cron expressions using croner's constructor (which throws on invalid patterns).
**When to use:** In the create/update agent schemas.
**Example:**
```typescript
import { Cron } from "croner";
import { z } from "zod";

const cronExpression = z.string().refine(
  (val) => {
    try {
      // Croner validates on construction; use paused to avoid scheduling
      const job = new Cron(val, { paused: true });
      job.stop();
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid cron expression" }
);
```

### Pattern 5: PATCH with Partial Schema
**What:** Use z.object().partial() for update operations so only changed fields are required.
**When to use:** The PATCH /agents/:id route.
**Example:**
```typescript
const updateAgentSchema = createAgentSchema.partial();
// All fields become optional. Only provided fields are updated.
```

### Anti-Patterns to Avoid
- **Re-querying the full agent list on every CRUD mutation:** Update the in-memory Map directly; only query DB at startup.
- **Using setInterval for scheduling:** Cron libraries handle drift, DST, and missed-second edge cases.
- **Sharing a single Cron instance for multiple agents:** Each agent gets its own Cron instance for independent lifecycle management.
- **Forgetting to stop old jobs on update:** Always call removeAgent before scheduleAgent to prevent ghost jobs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron parsing/scheduling | Custom cron parser | croner | Edge cases with DST, leap seconds, month boundaries, day-of-week logic |
| Request validation | Manual if/else validation | @hono/zod-validator | Type inference, field-level errors, consistent patterns |
| Cron expression validation | Regex matching | croner constructor (throws on invalid) | Regex cannot validate semantic correctness (e.g., Feb 30) |
| HTTP server for Node.js | Raw http.createServer | @hono/node-server | Handles request/response conversion, graceful shutdown |

**Key insight:** Cron expression parsing is deceptively complex -- day-of-week vs day-of-month interactions, month name aliases, range validation. Using croner's built-in validation avoids an entire category of bugs.

## Common Pitfalls

### Pitfall 1: SQLite Foreign Key Enforcement
**What goes wrong:** SQLite does not enforce foreign keys by default. The existing schema has `agent_id NOT NULL REFERENCES agents(id)` but without `PRAGMA foreign_keys = ON`, deleting an agent will silently leave orphaned execution history rows.
**Why it happens:** SQLite's default is foreign keys OFF for backwards compatibility.
**How to avoid:** The project already uses `db.$client.pragma("journal_mode = WAL")`. Add `db.$client.pragma("foreign_keys = ON")` in db/index.ts. Then modify the schema to use ON DELETE SET NULL so execution history is preserved.
**Warning signs:** Agent deletion succeeds but execution history references a non-existent agent.

### Pitfall 2: Stale Agent Data in Scheduler Closures
**What goes wrong:** The scheduler closure captures the agent object at schedule time. If the agent is updated via API, the scheduler still uses the old taskDescription/systemPrompt.
**Why it happens:** JavaScript closures capture references, but the agent object from the DB is a plain object snapshot.
**How to avoid:** On every cron trigger, re-read the agent from the database before executing. This ensures the latest taskDescription and systemPrompt are used.
**Warning signs:** Agent updates don't take effect until server restart.

### Pitfall 3: Duplicate Name Detection (409 Conflict)
**What goes wrong:** The UNIQUE index on agent name uses COLLATE NOCASE. Inserting a duplicate throws a SQLite error, but without proper handling it returns a 500 instead of 409.
**Why it happens:** SQLite throws a generic UNIQUE constraint error; you must catch it and return the right status code.
**How to avoid:** Catch the SQLite error (check for "UNIQUE constraint failed" in the message) and map it to a 409 response.
**Warning signs:** Creating an agent with a duplicate name returns 500 instead of 409.

### Pitfall 4: PATCH Updating updatedAt
**What goes wrong:** Drizzle's `.set()` only updates the fields you pass. The `updated_at` column has a DEFAULT but no trigger for updates -- it only gets the default on INSERT.
**Why it happens:** SQLite DEFAULT expressions only apply on INSERT, not UPDATE.
**How to avoid:** Always include `updatedAt: new Date().toISOString()` in every `.set()` call for PATCH operations.
**Warning signs:** updatedAt stays frozen at creation time.

### Pitfall 5: Graceful Shutdown
**What goes wrong:** Process exits without stopping cron jobs or closing the HTTP server, potentially leaving in-flight LLM calls unfinished.
**Why it happens:** No SIGINT/SIGTERM handlers registered.
**How to avoid:** Register signal handlers that call `stopAll()` on the scheduler and `server.close()` on the HTTP server.
**Warning signs:** Orphaned "running" status execution records after restart.

## Code Examples

### Hono Node.js Server Startup
```typescript
// Source: https://hono.dev/docs/getting-started/nodejs
import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();
app.get("/", (c) => c.text("Hello"));

const server = serve({ fetch: app.fetch, port: 3000 });
```

### Croner Job with Stop
```typescript
// Source: https://github.com/Hexagon/croner
import { Cron } from "croner";

const job = new Cron("0 */5 * * * *", { name: "my-job" }, async () => {
  console.log("Running...");
});

// Later: stop permanently
job.stop();

// Check next run
console.log(job.nextRun()); // Date | null
```

### zValidator with Custom Error Hook
```typescript
// Source: https://hono.dev/examples/validator-error-handling
import { zValidator } from "@hono/zod-validator";

app.post(
  "/agents",
  zValidator("json", createAgentSchema, (result, c) => {
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      return c.json({ error: "Validation failed", details }, 400);
    }
  }),
  handler
);
```

### Drizzle PATCH Update
```typescript
// Source: project pattern from Phase 2 (.returning().get())
import { eq } from "drizzle-orm";
import { agents } from "../db/schema.js";

const updated = db
  .update(agents)
  .set({ ...validatedFields, updatedAt: new Date().toISOString() })
  .where(eq(agents.id, id))
  .returning()
  .get();
```

### Foreign Key with ON DELETE SET NULL
```typescript
// Source: https://orm.drizzle.team/docs/indexes-constraints
agentId: integer("agent_id")
  .references(() => agents.id, { onDelete: "set null" })
  // Remove .notNull() -- must be nullable for SET NULL
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express.js | Hono | 2023-2024 | Lighter, faster, TypeScript-native, Web Standard APIs |
| node-cron | croner | 2023+ | Zero deps, TypeScript, stop/pause, expression validation |
| Manual body parsing | @hono/zod-validator | 2024 | Type-safe validated data, less boilerplate |
| Zod v3 in zod-validator | Zod v4 support | May 2025 | @hono/zod-validator supports Zod v4 via PR #1173 |

**Deprecated/outdated:**
- node-cron: Still works but lacks TypeScript types, nextRun(), and lifecycle methods
- Express validator middleware: Not applicable (using Hono)

## Discretion Recommendations

### Cron Library: croner
**Recommendation:** croner v10.x. Zero dependencies, TypeScript-native, provides stop()/pause()/resume(), validates expressions at construction, supports nextRun() for debugging. Clearly superior to node-cron for this use case.

### Hono Middleware: Minimal Logger + Global Error Handler
**Recommendation:** Use Hono's built-in logger middleware (`import { logger } from "hono/logger"`) for request logging. Implement a global `app.onError()` handler that converts all errors to the flat `{ error, details }` format. No additional middleware libraries needed.

### Execution History Pagination
**Recommendation:** Use `?limit=N` query parameter with a default of 50 and max of 200. Order by `started_at DESC`. This is simple, covers the common case (recent executions), and avoids cursor-based pagination complexity. Offset-based pagination is fine for a personal tool.

### Foreign Key Strategy for Agent Deletion
**Recommendation:** Change the FK to nullable with `ON DELETE SET NULL`. This means:
1. Modify `agentId` in executionHistory schema: remove `.notNull()`, add `{ onDelete: "set null" }`
2. Enable foreign key enforcement: `PRAGMA foreign_keys = ON`
3. Execution history rows survive agent deletion with `agent_id = NULL`
4. Run `drizzle-kit push` to apply the schema change

This is the cleanest approach -- execution history is preserved, the FK is database-enforced, and no application-level cascade logic is needed.

## Open Questions

1. **Schema migration for FK change**
   - What we know: The current schema has `agent_id NOT NULL REFERENCES agents(id)`. Changing to nullable + ON DELETE SET NULL requires a schema change.
   - What's unclear: Whether drizzle-kit push handles this cleanly for SQLite (SQLite has limited ALTER TABLE support -- typically requires table recreation).
   - Recommendation: Test `drizzle-kit push` with the change. If it fails, manually create a migration that recreates the table. Since this is early development with no production data, a fresh push should be fine.

2. **Scheduler re-reads vs closure capture**
   - What we know: Closures capture agent state at schedule time; updates change DB but not the closure.
   - What's unclear: Performance impact of re-reading agent from DB on every trigger.
   - Recommendation: Re-read from DB on each trigger. SQLite reads from a local file are sub-millisecond; the LLM call that follows takes seconds. The overhead is negligible.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGNT-01 | POST /agents creates agent with name, task, cron, system prompt | integration | `pnpm vitest run tests/routes-agents.test.ts -t "create"` | No -- Wave 0 |
| AGNT-02 | GET/PATCH/DELETE /agents CRUD operations | integration | `pnpm vitest run tests/routes-agents.test.ts -t "list\|get\|update\|delete"` | No -- Wave 0 |
| AGNT-03 | System prompt stored and returned in agent responses | integration | `pnpm vitest run tests/routes-agents.test.ts -t "system prompt"` | No -- Wave 0 |
| SCHD-01 | Scheduler registers and fires cron jobs | unit | `pnpm vitest run tests/scheduler.test.ts -t "schedule"` | No -- Wave 0 |
| SCHD-02 | Multiple agents schedule concurrently without conflicts | unit | `pnpm vitest run tests/scheduler.test.ts -t "concurrent"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/routes-agents.test.ts` -- covers AGNT-01, AGNT-02, AGNT-03 (Hono testClient or app.request for HTTP-level tests)
- [ ] `tests/scheduler.test.ts` -- covers SCHD-01, SCHD-02 (mock executeAgent, use croner with fast schedules)
- [ ] `tests/helpers/test-db.ts` -- shared in-memory SQLite setup for route tests (reuse pattern from db.test.ts)

### Testing Hono Routes
Hono provides `app.request()` for testing without a running server:
```typescript
const res = await app.request("/agents", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Test", taskDescription: "Do thing", cronSchedule: "* * * * *" }),
});
expect(res.status).toBe(201);
const body = await res.json();
expect(body.name).toBe("Test");
```

## Sources

### Primary (HIGH confidence)
- [Hono official docs - Node.js](https://hono.dev/docs/getting-started/nodejs) - serve() API, port config
- [Hono official docs - Validation](https://hono.dev/docs/guides/validation) - zValidator usage
- [Hono official docs - Error handling](https://hono.dev/examples/validator-error-handling) - custom error hook
- [Hono official docs - HTTPException](https://hono.dev/docs/api/exception) - onError pattern
- [Croner GitHub](https://github.com/Hexagon/croner) - API: Cron constructor, stop(), options
- [Croner docs](https://croner.56k.guru/) - Overview, features, options table
- [Drizzle ORM docs](https://orm.drizzle.team/docs/indexes-constraints) - FK actions including SET NULL
- [honojs/middleware #1173](https://github.com/honojs/middleware/issues/1148) - Zod v4 support confirmed

### Secondary (MEDIUM confidence)
- npm registry version checks: hono 4.12.8, croner 10.0.1, @hono/node-server 1.19.11, @hono/zod-validator 0.7.6

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries verified via official docs and npm registry
- Architecture: HIGH - patterns derived from official Hono examples and existing project conventions
- Pitfalls: HIGH - identified from real constraints (SQLite FK defaults, closure behavior, UNIQUE index handling)

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable libraries, unlikely to change)
