# Phase 4: Resilience and Observability - Research

**Researched:** 2026-03-14
**Domain:** Circuit breaker pattern, LLM cost tracking, health check endpoints
**Confidence:** HIGH

## Summary

Phase 4 adds two categories of infrastructure to Schedoodle: resilience (circuit breaker for the Anthropic API) and observability (token cost estimation, health check endpoint). The existing codebase already records `inputTokens` and `outputTokens` per execution, so cost tracking requires adding an `estimatedCost` column and computing it from a pricing lookup table. The circuit breaker wraps the existing `callLlmWithRetry()` function in `executor.ts`. The health check is a new Hono route.

The circuit breaker pattern is well-understood and the project's single-provider architecture (Anthropic only) means a custom implementation is appropriate -- no need for a library. The implementation is roughly 60 lines of TypeScript: track consecutive failures, trip after threshold, auto-reset after a cooldown window with a half-open probe.

**Primary recommendation:** Build a custom circuit breaker (~60 lines), store `estimatedCost` as a real column on `executionHistory`, use a config-driven pricing table keyed by model ID, and expose a GET `/health` endpoint with uptime, agent count, recent execution summary, and circuit breaker status.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all implementation choices are at Claude's discretion.

### Claude's Discretion
- Circuit breaker: library vs custom implementation (STATE.md flagged this as a Phase 4 decision)
- Circuit breaker thresholds: failure count to trip, timeout window, half-open behavior
- Where to integrate circuit breaker in the call chain (wrapping `callLlmWithRetry` in executor.ts)
- Cost estimation: pricing table format, where model rates are stored (config vs code constants)
- Cost calculation: how estimated cost is computed from inputTokens/outputTokens and stored
- Health check endpoint response shape (uptime, agent count, recent execution stats, circuit breaker status)
- Whether cost is a new DB column on executionHistory or computed at query time
- How per-agent cost aggregation is exposed (new endpoint vs extend existing /agents/:id/executions)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RSLN-01 | A circuit breaker per LLM provider prevents hammering a downed API | Custom circuit breaker module wrapping `callLlmWithRetry`; trips after consecutive failures, rejects calls fast when open |
| RSLN-02 | Circuit breaker auto-recovers when the provider comes back online | Half-open state after cooldown; single probe call, close on success, re-open on failure |
| OBSV-01 | Token usage and estimated cost are tracked per agent per execution | New `estimatedCost` real column on executionHistory; computed from pricing table after LLM response |
| OBSV-02 | A health check endpoint reports service status and basic operational info | New GET `/health` route returning uptime, agent count, recent execution summary, circuit breaker status |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Custom circuit-breaker.ts | N/A | Circuit breaker for LLM calls | Single provider, ~60 lines, no dependency overhead for a simple state machine |
| Drizzle ORM | ^0.45.1 | Schema migration for `estimatedCost` column | Already in use; `db:push` for schema sync |
| Hono | ^4.12.8 | Health check route | Already in use for all HTTP routes |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| drizzle-orm/sqlite-core | ^0.45.1 | `real()` column type for estimatedCost | Adding decimal cost column to schema |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom circuit breaker | opossum (v9.0.0, 1.5k GitHub stars) | Full-featured, event-driven, but adds dependency + @types/opossum for a ~60 line problem |
| Custom circuit breaker | cockatiel (v3.2.1) | TypeScript-first, Polly-inspired, but bundles retry/timeout/bulkhead we don't need |
| DB column for cost | Computed at query time | Avoids migration, but slower queries and pricing changes retroactively alter historical records |

**No new packages to install.** All changes use existing dependencies.

## Architecture Patterns

### Recommended Project Structure
```
src/
  services/
    circuit-breaker.ts   # NEW - circuit breaker state machine
    executor.ts          # MODIFIED - wrap LLM call with circuit breaker, compute cost
  routes/
    health.ts            # NEW - GET /health endpoint
  config/
    pricing.ts           # NEW - model pricing lookup table
  db/
    schema.ts            # MODIFIED - add estimatedCost column
  index.ts               # MODIFIED - mount health route, track startedAt for uptime
```

### Pattern 1: Circuit Breaker State Machine
**What:** A pure-function circuit breaker with three states (CLOSED, OPEN, HALF_OPEN) that wraps an async action. Tracks consecutive failures, not percentage-based (simpler for low-volume personal tool).
**When to use:** Wrapping any unreliable external call.
**Example:**
```typescript
// src/services/circuit-breaker.ts

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold: number;    // consecutive failures to trip (default: 3)
  resetTimeoutMs: number;      // ms before half-open probe (default: 30000)
  name: string;                // for logging/health reporting
}

export interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  lastFailureTime: number | null;
  name: string;
}

export function createCircuitBreaker(options: CircuitBreakerOptions) {
  let state: CircuitState = "CLOSED";
  let consecutiveFailures = 0;
  let lastFailureTime: number | null = null;

  function getStatus(): CircuitBreakerStatus {
    // Check if enough time has passed for half-open transition
    if (state === "OPEN" && lastFailureTime !== null) {
      if (Date.now() - lastFailureTime >= options.resetTimeoutMs) {
        state = "HALF_OPEN";
      }
    }
    return { state, failures: consecutiveFailures, lastFailureTime, name: options.name };
  }

  async function execute<T>(action: () => Promise<T>): Promise<T> {
    const status = getStatus();

    if (status.state === "OPEN") {
      throw new CircuitBreakerOpenError(options.name);
    }

    try {
      const result = await action();
      // Success: reset to CLOSED
      consecutiveFailures = 0;
      state = "CLOSED";
      return result;
    } catch (error) {
      consecutiveFailures++;
      lastFailureTime = Date.now();
      if (consecutiveFailures >= options.failureThreshold) {
        state = "OPEN";
      }
      throw error;
    }
  }

  return { execute, getStatus };
}

export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is OPEN - call rejected`);
    this.name = "CircuitBreakerOpenError";
  }
}
```

### Pattern 2: Pricing Lookup Table
**What:** A static map of model ID to input/output price per token, used to compute `estimatedCost` after each LLM call.
**When to use:** After receiving token counts from the AI SDK response.
**Example:**
```typescript
// src/config/pricing.ts

export interface ModelPricing {
  inputPerMTok: number;   // USD per million input tokens
  outputPerMTok: number;  // USD per million output tokens
}

// Source: https://platform.claude.com/docs/en/about-claude/pricing (2026-03-14)
const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-20250514": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4.5-20250514": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4.5-20250514": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-opus-4.5-20250514": { inputPerMTok: 5, outputPerMTok: 25 },
};

// Fallback: use Sonnet 4 pricing for unknown models
const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 3, outputPerMTok: 15 };

export function getModelPricing(modelId: string): ModelPricing {
  return MODEL_PRICING[modelId] ?? DEFAULT_PRICING;
}

export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getModelPricing(modelId);
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok
  );
}
```

### Pattern 3: Health Check Endpoint
**What:** A lightweight GET endpoint that aggregates service status without heavy DB queries.
**When to use:** Monitoring, load balancer health probes.
**Example:**
```typescript
// src/routes/health.ts
import { Hono } from "hono";
import type { Database } from "../db/index.js";

export function createHealthRoute(
  db: Database,
  getCircuitStatus: () => CircuitBreakerStatus,
  startedAt: number,
) {
  const app = new Hono();

  app.get("/", (c) => {
    const uptimeMs = Date.now() - startedAt;
    const agentCount = db.select({ count: count() }).from(agents).get();
    const recentExecutions = db
      .select({ /* status counts */ })
      .from(executionHistory)
      .where(gte(executionHistory.startedAt, last24h))
      .all();

    return c.json({
      status: "ok",
      uptimeMs,
      agentCount: agentCount?.count ?? 0,
      circuitBreaker: getCircuitStatus(),
      recentExecutions: { success: N, failure: M, total: N+M },
    });
  });

  return app;
}
```

### Anti-Patterns to Avoid
- **Percentage-based thresholds for low-volume systems:** With agents running on cron (maybe a few calls per hour), percentage-based circuit breakers (like opossum's default 50% error rate) are unreliable. A single failure out of 2 calls = 50% error rate. Use consecutive failure counts instead.
- **Storing cost as computed-only:** If pricing changes, historical costs would shift retroactively. Store `estimatedCost` at execution time for accurate historical records.
- **Heavy health check queries:** Don't scan the entire execution_history table. Use a time-bounded window (last 24 hours) with indexed columns.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron scheduling | Custom timer loop | croner (already in use) | Edge cases with DST, expression parsing |
| HTTP routing | Raw Node http | Hono (already in use) | Middleware, error handling, validation |
| Schema migrations | Raw SQL ALTER TABLE | `drizzle-kit push` (already in use) | Schema diffing, type safety |

**Key insight:** The circuit breaker IS appropriate to hand-roll here because (a) single provider, (b) consecutive-failure model is ~50 lines, (c) avoids adding a dependency with its own @types package for trivial functionality.

## Common Pitfalls

### Pitfall 1: Circuit Breaker Never Closes After Recovery
**What goes wrong:** The half-open probe fails once and the circuit stays open forever because the reset timeout restarts.
**Why it happens:** Re-opening the circuit resets `lastFailureTime` to now, pushing the next half-open check further into the future.
**How to avoid:** On half-open failure, set state back to OPEN but do NOT reset `lastFailureTime` -- keep the original failure time so the next half-open probe comes after `resetTimeoutMs` from the latest failure, not from the original.
**Warning signs:** Circuit stays OPEN for hours/days despite provider being back up.

### Pitfall 2: Cost Precision with Floating Point
**What goes wrong:** Accumulated costs drift due to IEEE 754 floating point arithmetic.
**Why it happens:** Multiplying small token counts by fractional per-token prices compounds rounding errors.
**How to avoid:** Use SQLite `REAL` type (64-bit double) which has sufficient precision for cost tracking at this scale. Round to 6 decimal places when storing. For display, format to 4-6 decimal places.
**Warning signs:** Aggregated costs don't match sum of individual execution costs.

### Pitfall 3: Health Check Blocking on Slow DB
**What goes wrong:** Health check endpoint times out because it runs an expensive aggregation query.
**Why it happens:** Counting all execution history without a time bound or index.
**How to avoid:** Query only last 24 hours of executions. The `startedAt` column is text (ISO format) which sorts correctly. For future optimization, consider an index on `startedAt`.
**Warning signs:** Health endpoint latency > 100ms.

### Pitfall 4: Model ID Mismatch in Pricing Table
**What goes wrong:** Cost is always computed with default/fallback pricing because model IDs don't match the table keys.
**Why it happens:** Anthropic model IDs have date suffixes that change with releases. The agent's `model` column might use a different format than the pricing table keys.
**How to avoid:** Use prefix matching: strip or ignore date suffixes. Or normalize model IDs on entry. Log when falling back to default pricing so it's visible.
**Warning signs:** All executions have identical cost-per-token regardless of model.

## Code Examples

### Adding `estimatedCost` Column to Schema
```typescript
// src/db/schema.ts - add to executionHistory table
import { real } from "drizzle-orm/sqlite-core";

// Add to executionHistory columns:
estimatedCost: real("estimated_cost"),
```

### Computing Cost in Executor
```typescript
// In executor.ts, after successful LLM call:
const inputTok = result.usage.inputTokens ?? 0;
const outputTok = result.usage.outputTokens ?? 0;
const cost = estimateCost(modelId, inputTok, outputTok);

db.update(executionHistory)
  .set({
    status: "success",
    result: output,
    inputTokens: inputTok,
    outputTokens: outputTok,
    estimatedCost: cost,
    durationMs,
    completedAt: new Date().toISOString(),
  })
  .where(eq(executionHistory.id, executionId))
  .run();
```

### Integrating Circuit Breaker in Executor
```typescript
// In executor.ts - create breaker at module level
import { createCircuitBreaker, CircuitBreakerOpenError } from "./circuit-breaker.js";

const llmBreaker = createCircuitBreaker({
  name: "anthropic",
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
});

// Wrap the LLM call:
const result = await llmBreaker.execute(() =>
  callLlmWithRetry(modelId, agent.systemPrompt, userMessage)
);

// Export for health route:
export function getLlmCircuitStatus() {
  return llmBreaker.getStatus();
}
```

### Mounting Health Route
```typescript
// In index.ts:
import { createHealthRoute } from "./routes/health.js";
import { getLlmCircuitStatus } from "./services/executor.js";

const startedAt = Date.now();
app.route("/health", createHealthRoute(db, getLlmCircuitStatus, startedAt));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Percentage-based thresholds | Consecutive failure counts for low-volume | N/A (design choice) | More reliable for cron-based agents with few calls/hour |
| Compute cost at query time | Store cost at execution time | N/A (design choice) | Immutable historical costs; no retroactive pricing drift |
| Separate monitoring endpoint | Combined health + circuit status | Common pattern | Single endpoint for service health probes |

## Open Questions

1. **Exact Anthropic model ID format for newer models**
   - What we know: Current default is `claude-sonnet-4-20250514`. Pricing table uses date-suffixed IDs.
   - What's unclear: Exact model IDs for haiku-4.5, opus-4.5, sonnet-4.5 as recognized by @ai-sdk/anthropic.
   - Recommendation: Use prefix matching in the pricing lookup. Include the known model IDs from the project's `DEFAULT_MODEL` constant. Log a warning when falling back to default pricing.

2. **Per-agent cost aggregation endpoint**
   - What we know: GET `/agents/:id/executions` already returns execution history with token counts. Adding `estimatedCost` to the response is automatic via schema.
   - What's unclear: Whether a dedicated cost summary endpoint is needed vs. client-side aggregation.
   - Recommendation: Let the existing executions endpoint return `estimatedCost` per row. A summary can be added in a future iteration if needed. Keep scope minimal.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RSLN-01 | Circuit breaker trips after N consecutive failures and rejects subsequent calls | unit | `pnpm vitest run tests/circuit-breaker.test.ts -t "trips"` | Wave 0 |
| RSLN-01 | Circuit breaker passes calls through when CLOSED | unit | `pnpm vitest run tests/circuit-breaker.test.ts -t "closed"` | Wave 0 |
| RSLN-02 | Circuit breaker transitions to HALF_OPEN after resetTimeout and closes on probe success | unit | `pnpm vitest run tests/circuit-breaker.test.ts -t "half-open"` | Wave 0 |
| RSLN-02 | Circuit breaker re-opens on probe failure during HALF_OPEN | unit | `pnpm vitest run tests/circuit-breaker.test.ts -t "re-open"` | Wave 0 |
| OBSV-01 | estimateCost returns correct USD for known model | unit | `pnpm vitest run tests/pricing.test.ts -t "cost"` | Wave 0 |
| OBSV-01 | Executor records estimatedCost in execution history | unit | `pnpm vitest run tests/executor.test.ts -t "cost"` | Extend existing |
| OBSV-02 | Health endpoint returns uptime, agentCount, circuitBreaker, recentExecutions | unit | `pnpm vitest run tests/health.test.ts -t "health"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/circuit-breaker.test.ts` -- covers RSLN-01, RSLN-02
- [ ] `tests/pricing.test.ts` -- covers OBSV-01 (cost computation)
- [ ] `tests/health.test.ts` -- covers OBSV-02

*(Existing `tests/executor.test.ts` will be extended for cost recording.)*

## Sources

### Primary (HIGH confidence)
- [Anthropic Official Pricing](https://platform.claude.com/docs/en/about-claude/pricing) -- full model pricing table, verified 2026-03-14
- Existing codebase: `src/services/executor.ts`, `src/db/schema.ts`, `src/routes/agents.ts` -- current implementation patterns

### Secondary (MEDIUM confidence)
- [Opossum GitHub](https://github.com/nodeshift/opossum) -- circuit breaker library API and features (v9.0.0)
- [Opossum Documentation](https://nodeshift.dev/opossum/) -- configuration options and events
- [Cockatiel npm](https://www.npmjs.com/package/cockatiel) -- TypeScript resilience library (v3.2.1)

### Tertiary (LOW confidence)
- None -- all findings verified with primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, extending existing patterns
- Architecture: HIGH -- circuit breaker pattern is well-understood, integration points are clear from code inspection
- Pitfalls: HIGH -- common circuit breaker issues are well-documented; pricing precision is straightforward at this scale

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable domain, pricing may shift but pattern won't)
