# Phase 8: Enhanced Health Monitoring with Agent Health Flags and Execution Diagnostics - Research

**Researched:** 2026-03-15
**Domain:** Observability enhancement -- per-agent health flags, aggregate statistics, upcoming runs, execution log enrichment
**Confidence:** HIGH

## Summary

This phase enriches the existing `/health` endpoint and agent API responses with per-agent health breakdowns, system-wide aggregate statistics, upcoming scheduled runs, and a top-level health status indicator. It also adds a `retryCount` column to execution history and adjusts the default execution listing limit. All changes build entirely on top of existing infrastructure: Drizzle ORM for queries, croner for schedule introspection, the `enrichAgent` helper for computed fields, and the `createHealthRoute` factory for the health endpoint.

The implementation requires no new dependencies. The core technical challenges are: (1) efficiently computing consecutive failures per agent for the "healthy" flag, (2) gathering upcoming scheduled runs across all agents from the croner job registry, and (3) restructuring the health endpoint response while preserving backward-compatible fields.

**Primary recommendation:** Expose the scheduler's job map via a `getScheduledJobs()` function, compute per-agent health stats via bounded SQL queries in the health route, and extend `enrichAgent` with a `healthy` boolean flag.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Enhance existing `/health` endpoint (not a separate `/status`)
- Include per-agent breakdown with full stats per agent: lastRunAt, lastStatus, successRate, avgDurationMs, healthy flag, consecutiveFailures count
- Include next 5 upcoming scheduled runs across all agents (agent name + scheduled time)
- Top-level status field reflects system health: `ok` / `degraded` (some agents unhealthy) / `unhealthy` (circuit breaker open or most agents failing)
- System-wide aggregates: success rate and average duration (24h window, matching current behavior)
- Flag only -- do not auto-disable unhealthy agents
- Threshold: 3 consecutive failures marks an agent as unhealthy
- Auto-recover: agent becomes healthy again as soon as its next run succeeds
- Unhealthy flag visible in both `/health` per-agent breakdown AND individual agent API responses (GET /agents, GET /agents/:id) via enrichAgent
- Add `retryCount` integer column to execution_history schema (tracks LLM validation retries per execution)
- Store full result/error data in DB, truncate to ~200 chars in health endpoint and listing responses
- Full detail remains available via GET /agents/:id/executions
- Keep agentId with enrich-on-read pattern (no denormalized agent name column)
- Change default limit from 50 to 100 per agent in GET /agents/:id/executions
- Keep max cap at 200
- No automatic deletion of old records -- query limit only (rolling window via query, not pruning)
- 24-hour time window for all aggregates (matches current /health behavior)
- Add computed successRate (percentage) and avgDurationMs to system-wide stats
- Per-agent stats include the same aggregates within the per-agent breakdown

### Claude's Discretion
- Exact response shape and field naming for enhanced /health
- How to efficiently compute consecutive failures (query strategy)
- How to gather next 5 upcoming runs from croner instances
- Whether to extract health computation into a service or keep in route handler

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

## Standard Stack

### Core (already installed -- no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.45.1 | SQL queries for aggregates, per-agent stats | Already used for all DB operations |
| croner | ^10.0.1 | Query nextRun() from scheduled jobs for upcoming runs | Already used for cron scheduling |
| hono | ^4.12.8 | HTTP route handler for enhanced /health | Already used for all routes |
| better-sqlite3 | ^12.8.0 | SQLite database driver | Already used as DB driver |

### Supporting (already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| drizzle-kit | ^0.31.9 | Schema push for new retryCount column | `pnpm db:push` after schema change |
| vitest | ^4.1.0 | Unit tests | All new functionality |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JS-computed aggregates | SQL aggregate queries (avg, count, group by) | SQL is more efficient for per-agent groupBy; but project uses JS filtering pattern for bounded sets. Recommend SQL for per-agent groupBy since we need stats across ALL agents. |
| Exposing scheduler jobs map | Querying agents table + croner per agent | Querying the scheduler map is more accurate (only shows truly scheduled agents) and avoids creating temporary Cron instances |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── helpers/
│   └── enrich-agent.ts     # ADD: healthy flag, consecutiveFailures computation
├── routes/
│   └── health.ts           # MAJOR: per-agent breakdown, aggregates, upcoming runs, status levels
├── routes/
│   └── agents.ts           # MINOR: change default limit from 50 to 100
├── services/
│   └── scheduler.ts        # ADD: getScheduledJobs() export for upcoming runs
│   └── executor.ts         # MODIFY: callLlmWithRetry returns retryCount, record in DB
└── db/
    └── schema.ts           # ADD: retryCount column to executionHistory
```

### Pattern 1: Health Computation as Service Helper
**What:** Extract health computation logic (per-agent stats, aggregate stats, upcoming runs, status determination) into a helper/service module rather than embedding it all in the route handler.
**When to use:** When the health route handler would exceed ~50 lines of logic.
**Recommendation:** Extract into `src/helpers/health-stats.ts` or similar. The route handler should remain thin (query + format + respond). This keeps the health route testable and the computation logic independently unit-testable.
**Example:**
```typescript
// src/helpers/health-stats.ts
export interface AgentHealthStats {
  agentId: number;
  agentName: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  successRate: number;
  avgDurationMs: number;
  healthy: boolean;
  consecutiveFailures: number;
}

export function computeAgentHealthStats(
  agentId: number,
  agentName: string,
  executions: Execution[],
): AgentHealthStats {
  // Filter to 24h window, compute stats in JS
}
```

### Pattern 2: Consecutive Failures via Bounded Query
**What:** Query the most recent N executions per agent (ordered by startedAt DESC) and count consecutive failures from the top.
**When to use:** For the "healthy" flag computation.
**Strategy:** Query the last 3 executions per agent. If all 3 are "failure", the agent is unhealthy. This avoids scanning all history -- just the last 3 rows per agent.
**Example:**
```typescript
// For a single agent (enrichAgent context):
function getConsecutiveFailures(agentId: number, db: Database): number {
  const recent = db
    .select({ status: executionHistory.status })
    .from(executionHistory)
    .where(eq(executionHistory.agentId, agentId))
    .orderBy(desc(executionHistory.startedAt))
    .limit(3)
    .all();

  let count = 0;
  for (const row of recent) {
    if (row.status === "failure") count++;
    else break;
  }
  return count;
}
```

### Pattern 3: Upcoming Runs from Scheduler Job Registry
**What:** Expose the scheduler's internal `jobs` Map via a getter function, then iterate all jobs to get their nextRun() times, sort, and take the first 5.
**When to use:** For the "upcomingRuns" section of the health endpoint.
**Key insight:** The scheduler already stores `Map<number, Cron>` keyed by agent ID. Croner's `nextRun()` returns a Date. We also need agent names, so we join against the agents table or pass agent data alongside.
**Example:**
```typescript
// In scheduler.ts -- add this export:
export function getScheduledJobs(): Map<number, Cron> {
  return jobs; // Read-only use by health route
}

// In health route or health helper:
function getUpcomingRuns(
  scheduledJobs: Map<number, Cron>,
  agentLookup: Map<number, string>, // id -> name
  count: number = 5,
): Array<{ agentName: string; scheduledAt: string }> {
  const upcoming: Array<{ agentName: string; scheduledAt: string }> = [];

  for (const [agentId, job] of scheduledJobs) {
    const next = job.nextRun();
    if (next) {
      upcoming.push({
        agentName: agentLookup.get(agentId) ?? `agent-${agentId}`,
        scheduledAt: next.toISOString(),
      });
    }
  }

  return upcoming
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, count);
}
```

### Pattern 4: Top-Level Status Determination
**What:** Derive the top-level `status` field from agent health states and circuit breaker state.
**Rules (from CONTEXT.md):**
- `ok`: All agents healthy and circuit breaker closed
- `degraded`: Some agents unhealthy but system still functional
- `unhealthy`: Circuit breaker open OR most agents failing
**Example:**
```typescript
function determineSystemStatus(
  agentStats: AgentHealthStats[],
  circuitState: CircuitState,
): "ok" | "degraded" | "unhealthy" {
  if (circuitState === "OPEN") return "unhealthy";

  const unhealthyCount = agentStats.filter(a => !a.healthy).length;
  if (unhealthyCount === 0) return "ok";
  if (unhealthyCount > agentStats.length / 2) return "unhealthy";
  return "degraded";
}
```

### Pattern 5: Result/Error Truncation for Listing Responses
**What:** Store full result/error in DB, truncate to ~200 chars in summary views.
**When to use:** Health endpoint per-agent data and execution listing responses.
**Example:**
```typescript
function truncate(value: unknown, maxLength: number = 200): string | null {
  if (value === null || value === undefined) return null;
  const str = typeof value === "string" ? value : JSON.stringify(value);
  return str.length > maxLength ? str.slice(0, maxLength) + "..." : str;
}
```

### Pattern 6: retryCount Tracking in callLlmWithRetry
**What:** Modify `callLlmWithRetry` to return retryCount alongside the existing result, then record it in the execution history DB update.
**Example:**
```typescript
async function callLlmWithRetry(
  modelId: string,
  systemPrompt: string | null,
  userMessage: string,
): Promise<{ result: GenerateTextResult; retryCount: number }> {
  const model = await resolveModel(modelId);
  try {
    const result = await generateText({ /* ... */ });
    return { result, retryCount: 0 };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      const result = await generateText({ /* retry prompt */ });
      return { result, retryCount: 1 };
    }
    throw error;
  }
}
```

### Anti-Patterns to Avoid
- **SQL aggregation for per-agent stats in a loop:** Don't run a separate aggregate SQL query per agent inside a for-loop. Instead, query all recent executions once (24h window) and group in JS, or use a single SQL query with GROUP BY agentId.
- **Creating temporary Cron instances for upcoming runs:** Don't create and stop temporary Cron instances when the scheduler already has live ones. Use the scheduler's existing job map.
- **Denormalizing agent names into execution_history:** The CONTEXT.md explicitly says to keep the enrich-on-read pattern. Don't add an agentName column to the schema.
- **Auto-disabling unhealthy agents:** The CONTEXT.md explicitly says flag-only, no auto-disable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Next run time computation | Custom cron parser | `croner.nextRun()` on existing job instances | Croner already handles timezone, DST, all cron edge cases |
| ISO date formatting | Manual string formatting | `Date.toISOString()` | Already used everywhere in the project |
| Cron expression validation | Regex matching | `new Cron(expr, { paused: true })` then stop() | Already the project pattern (from Phase 3) |

**Key insight:** This phase is entirely about querying and reshaping existing data. No new external capabilities are needed -- just smarter aggregation and presentation of what already exists.

## Common Pitfalls

### Pitfall 1: N+1 Queries in Per-Agent Stats
**What goes wrong:** Computing stats per agent by running separate queries for each agent (consecutive failures, success rate, avg duration) causes N+1 query problems.
**Why it happens:** Natural to write a loop that queries per agent.
**How to avoid:** Fetch all recent executions (24h) in a single query, then group by agentId in JavaScript. For consecutive failures, fetch the last 3 per agent in a separate bounded query. Given SQLite and bounded agent counts, this is acceptable.
**Warning signs:** Health endpoint becomes slow with >10 agents.

### Pitfall 2: Memory Leak from Croner Instances
**What goes wrong:** Creating temporary Cron instances for schedule inspection without stopping them leaves timers running.
**Why it happens:** The `new Cron(pattern)` constructor immediately starts the timer by default.
**How to avoid:** For upcoming runs, use the scheduler's existing live Cron instances (via `getScheduledJobs()`). If creating temporary ones, always pass `{ paused: true }` and call `.stop()` after use -- this is already the project pattern in `enrich-agent.ts`.
**Warning signs:** Process memory growing over time, unexpected cron triggers.

### Pitfall 3: Stale Status During Concurrent Execution
**What goes wrong:** An agent that is mid-execution shows `status: "running"` in the execution_history, which could be counted as neither success nor failure.
**Why it happens:** The executor inserts a "running" record before the LLM call, updates to success/failure after.
**How to avoid:** Exclude "running" status rows from success rate calculations. Only count "success" and "failure" for aggregate stats.
**Warning signs:** Success rates don't add up to 100% of the total.

### Pitfall 4: Division by Zero in Success Rate
**What goes wrong:** New agents with zero executions produce NaN/Infinity for successRate and avgDurationMs.
**Why it happens:** Dividing by zero when no executions exist in the 24h window.
**How to avoid:** Default to 100% success rate and 0 avgDurationMs when there are no executions. Or return null to indicate "no data yet."
**Warning signs:** JSON serialization of NaN produces `null` in some environments, Infinity throws.

### Pitfall 5: Schema Push Breaks Existing Data
**What goes wrong:** Adding a new NOT NULL column without a default to an existing table breaks `drizzle-kit push`.
**Why it happens:** Existing rows lack a value for the new column.
**How to avoid:** Add `retryCount` as `integer("retry_count").default(0)` -- nullable or with a default. Since it's optional metadata, `.default(0)` is appropriate.
**Warning signs:** `pnpm db:push` fails or data is lost.

### Pitfall 6: callLlmWithRetry Return Shape Change
**What goes wrong:** Changing `callLlmWithRetry` to return `{ result, retryCount }` instead of just the result breaks the calling code in `executeAgent`.
**Why it happens:** The function return type changes.
**How to avoid:** Update `executeAgent` to destructure the new return shape. The change is internal (not exported), so only `executeAgent` needs updating.
**Warning signs:** TypeScript compilation errors (which is good -- the compiler catches this).

## Code Examples

Verified patterns from the existing codebase:

### Drizzle Aggregate Query with Group By
```typescript
// Source: Drizzle ORM official docs (https://orm.drizzle.team/docs/select)
import { avg, count, eq, gte } from "drizzle-orm";

// Per-agent aggregate stats in a single query (24h window)
const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const perAgentStats = db
  .select({
    agentId: executionHistory.agentId,
    total: count(),
    successCount: count(/* filtered -- see note */),
    avgDuration: avg(executionHistory.durationMs),
  })
  .from(executionHistory)
  .where(gte(executionHistory.startedAt, twentyFourHoursAgo))
  .groupBy(executionHistory.agentId)
  .all();
```

**Note on filtered count:** Drizzle doesn't have a built-in `countIf`. Use the existing project pattern: fetch rows, filter in JS. This is the established "bounded result set" pattern from Phase 4.

### Existing enrichAgent Pattern (extend this)
```typescript
// Source: src/helpers/enrich-agent.ts
export function enrichAgent(agent: Agent, db: Database): AgentResponse {
  return {
    ...agent,
    enabled: Boolean(agent.enabled),
    nextRunAt: getNextRunAt(agent),
    lastRunAt: getLastRunAt(agent.id, db),
    // Phase 8 additions:
    // healthy: !isUnhealthy(agent.id, db),
    // consecutiveFailures: getConsecutiveFailures(agent.id, db),
  };
}
```

### Croner nextRun() from Job Registry
```typescript
// Source: croner docs (https://croner.56k.guru/)
// Croner Cron instance methods:
const job: Cron = jobs.get(agentId);
const nextRunDate: Date | null = job.nextRun(); // Returns Date or null
const pattern: string = job.getPattern();        // Returns original cron string
const name: string | undefined = job.name;       // Optional name from options
```

### Existing Health Route Pattern (will be extended)
```typescript
// Source: src/routes/health.ts
// Current: returns { status, uptimeMs, agentCount, circuitBreaker, recentExecutions }
// Phase 8: add agents (per-agent breakdown), upcomingRuns, successRate, avgDurationMs
// Phase 8: change status from static "ok" to computed "ok"/"degraded"/"unhealthy"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Simple "ok" status | Computed status from agent health | Phase 8 | Status actually reflects system state |
| Aggregate-only execution stats | Per-agent breakdown | Phase 8 | Per-agent visibility for debugging |
| No retry tracking | retryCount column | Phase 8 | Diagnostic insight into LLM reliability |
| Default 50 executions | Default 100 executions | Phase 8 | Larger diagnostic window by default |

**Existing patterns preserved:**
- Factory functions with dependency injection (createHealthRoute)
- enrichAgent for computed response fields
- Drizzle push-based schema management (no migration files)
- JS filtering on bounded result sets
- In-memory Cron job registry via Map<number, Cron>

## Open Questions

1. **AgentResponse type update for healthy flag**
   - What we know: `AgentResponse` in `src/types/index.ts` currently has `enabled: boolean, nextRunAt, lastRunAt`
   - What's unclear: Whether to add `healthy` and `consecutiveFailures` as always-present fields or only in certain response contexts
   - Recommendation: Add both as required fields to AgentResponse since CONTEXT.md says "visible in GET /agents, GET /agents/:id via enrichAgent"

2. **Health endpoint response shape backward compatibility**
   - What we know: Current shape is `{ status, uptimeMs, agentCount, circuitBreaker, recentExecutions }`
   - What's unclear: Whether to keep all existing top-level fields and add new ones alongside, or restructure
   - Recommendation: Keep all existing fields for backward compatibility, add new fields alongside. The `recentExecutions` object gains `successRate` and `avgDurationMs`. New `agents` array and `upcomingRuns` array are added at top level.

3. **createHealthRoute signature change**
   - What we know: Currently takes `(db, getCircuitStatus, startedAt)`. Needs access to scheduled jobs for upcoming runs.
   - Recommendation: Add a `getScheduledJobs` callback parameter, matching the existing dependency injection pattern. Or inject a function that returns the upcoming runs directly.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P8-01 | Per-agent health breakdown in /health response | unit | `pnpm exec vitest run tests/health.test.ts -t "per-agent"` | Needs update |
| P8-02 | Consecutive failure detection (3 failures = unhealthy) | unit | `pnpm exec vitest run tests/helpers-enrich-agent.test.ts -t "healthy"` | Needs update |
| P8-03 | Auto-recover healthy flag on success | unit | `pnpm exec vitest run tests/helpers-enrich-agent.test.ts -t "recover"` | Needs update |
| P8-04 | Top-level status ok/degraded/unhealthy | unit | `pnpm exec vitest run tests/health.test.ts -t "status"` | Needs update |
| P8-05 | Next 5 upcoming scheduled runs | unit | `pnpm exec vitest run tests/health.test.ts -t "upcoming"` | Needs update |
| P8-06 | retryCount column and recording | unit | `pnpm exec vitest run tests/executor.test.ts -t "retryCount"` | Needs update |
| P8-07 | Default limit changed to 100 | unit | `pnpm exec vitest run tests/routes-agents.test.ts -t "limit"` | Needs update |
| P8-08 | System-wide successRate and avgDurationMs | unit | `pnpm exec vitest run tests/health.test.ts -t "aggregate"` | Needs update |
| P8-09 | Healthy flag in enrichAgent (GET /agents responses) | unit | `pnpm exec vitest run tests/helpers-enrich-agent.test.ts -t "enrichAgent"` | Needs update |
| P8-10 | Result/error truncation in health endpoint | unit | `pnpm exec vitest run tests/health.test.ts -t "truncat"` | Needs update |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/health.test.ts` -- needs significant updates: per-agent breakdown, upcoming runs, status levels, aggregates, truncation
- [ ] `tests/helpers-enrich-agent.test.ts` -- needs updates for healthy flag, consecutiveFailures
- [ ] `tests/executor.test.ts` -- needs updates for retryCount recording
- [ ] `tests/routes-agents.test.ts` -- needs update for default limit change to 100
- [ ] `tests/db.test.ts` -- may need update for new retryCount column in CREATE SQL

**Note:** All test files use inline CREATE TABLE SQL (not schema.ts), so they must be updated to include the new `retry_count` column.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/routes/health.ts`, `src/helpers/enrich-agent.ts`, `src/services/scheduler.ts`, `src/services/executor.ts`, `src/db/schema.ts` -- direct code inspection
- [Croner docs](https://croner.56k.guru/) -- nextRun(), nextRuns(), getPattern(), name property API
- [Croner GitHub](https://github.com/Hexagon/croner) -- Cron class properties and methods
- [Drizzle ORM Select docs](https://orm.drizzle.team/docs/select) -- aggregate functions (avg, count), groupBy, having

### Secondary (MEDIUM confidence)
- [npm croner](https://www.npmjs.com/package/croner) -- version confirmation, API methods
- [Drizzle ORM count rows](https://orm.drizzle.team/docs/guides/count-rows) -- count patterns

### Tertiary (LOW confidence)
- None -- all findings verified with primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, all libraries already in use and verified
- Architecture: HIGH - All patterns extend existing codebase patterns, verified via direct code inspection
- Pitfalls: HIGH - All identified from reading the actual implementation (N+1, memory leaks, division by zero)
- Croner API: HIGH - Verified via official docs that nextRun() and getPattern() exist on Cron instances
- Drizzle aggregates: HIGH - Verified via official docs that avg(), count(), groupBy() are available

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable -- all libraries already installed, no version changes needed)
