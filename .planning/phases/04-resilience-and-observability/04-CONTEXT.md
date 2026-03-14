# Phase 4: Resilience and Observability - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Circuit breaker for LLM provider failures (trip on repeated errors, auto-recover when provider comes back) and observability features (token cost estimation per execution, health check endpoint). No new agent features, no new API CRUD, no email delivery.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
- Circuit breaker: library vs custom implementation (STATE.md flagged this as a Phase 4 decision)
- Circuit breaker thresholds: failure count to trip, timeout window, half-open behavior
- Where to integrate circuit breaker in the call chain (wrapping `callLlmWithRetry` in executor.ts)
- Cost estimation: pricing table format, where model rates are stored (config vs code constants)
- Cost calculation: how estimated cost is computed from inputTokens/outputTokens and stored
- Health check endpoint response shape (uptime, agent count, recent execution stats, circuit breaker status)
- Whether cost is a new DB column on executionHistory or computed at query time
- How per-agent cost aggregation is exposed (new endpoint vs extend existing /agents/:id/executions)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. This is an infrastructure phase; Claude has full discretion on implementation choices.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/executor.ts`: `callLlmWithRetry()` is the LLM call point — circuit breaker wraps here
- `src/services/executor.ts`: Already records inputTokens/outputTokens from AI SDK response usage
- `src/db/schema.ts`: executionHistory table has inputTokens, outputTokens, durationMs columns
- `src/index.ts`: Hono app with route mounting — health check is another route
- `src/routes/agents.ts`: GET /agents/:id/executions already returns execution history
- `src/config/env.ts`: Zod env schema — can add cost-related config here

### Established Patterns
- Zod v4 for all validation
- Hono for HTTP routes with factory functions for DI
- Plain functions for services (not classes)
- ESM with .js extensions
- Vitest with mocked dependencies for unit tests

### Integration Points
- `src/services/circuit-breaker.ts` (new) wraps the `anthropic()` model call in executor.ts
- `src/routes/health.ts` (new) mounted on Hono app in index.ts
- executionHistory table may need an `estimatedCost` column (or computed at query time)
- executor.ts needs to calculate cost after receiving token counts

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-resilience-and-observability*
*Context gathered: 2026-03-14*
