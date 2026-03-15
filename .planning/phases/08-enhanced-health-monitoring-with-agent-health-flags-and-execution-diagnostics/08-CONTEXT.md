# Phase 8: Enhanced Health Monitoring with Agent Health Flags and Execution Diagnostics - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Enrich the system's observability by enhancing the existing `/health` endpoint with per-agent health flags, aggregate statistics, upcoming scheduled runs, and diagnostic-quality execution logging. No new agent capabilities, no new CRUD operations, no UI.

</domain>

<decisions>
## Implementation Decisions

### Status endpoint design
- Enhance existing `/health` endpoint (not a separate `/status`)
- Include per-agent breakdown with full stats per agent: lastRunAt, lastStatus, successRate, avgDurationMs, healthy flag, consecutiveFailures count
- Include next 5 upcoming scheduled runs across all agents (agent name + scheduled time)
- Top-level status field reflects system health: `ok` / `degraded` (some agents unhealthy) / `unhealthy` (circuit breaker open or most agents failing)
- System-wide aggregates: success rate and average duration (24h window, matching current behavior)

### Unhealthy agent detection
- Flag only — do not auto-disable unhealthy agents
- Threshold: 3 consecutive failures marks an agent as unhealthy
- Auto-recover: agent becomes healthy again as soon as its next run succeeds
- Unhealthy flag visible in both `/health` per-agent breakdown AND individual agent API responses (GET /agents, GET /agents/:id) via enrichAgent

### Execution log enrichment
- Add `retryCount` integer column to execution_history schema (tracks LLM validation retries per execution)
- Store full result/error data in DB, truncate to ~200 chars in health endpoint and listing responses
- Full detail remains available via GET /agents/:id/executions
- Keep agentId with enrich-on-read pattern (no denormalized agent name column)

### Execution history defaults
- Change default limit from 50 to 100 per agent in GET /agents/:id/executions
- Keep max cap at 200
- No automatic deletion of old records — query limit only (rolling window via query, not pruning)

### Aggregate statistics
- 24-hour time window for all aggregates (matches current /health behavior)
- Add computed successRate (percentage) and avgDurationMs to system-wide stats
- Per-agent stats include the same aggregates within the per-agent breakdown

### Claude's Discretion
- Exact response shape and field naming for enhanced /health
- How to efficiently compute consecutive failures (query strategy)
- How to gather next 5 upcoming runs from croner instances
- Whether to extract health computation into a service or keep in route handler

</decisions>

<specifics>
## Specific Ideas

- Unhealthy detection mirrors the circuit breaker auto-recovery pattern already in the system — familiar mental model
- "Last 100 runs per agent" is the default diagnostic window the user expects

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/routes/health.ts`: Current health endpoint — will be enhanced in place
- `src/helpers/enrich-agent.ts`: Enriches agent responses with nextRunAt, lastRunAt — extend with healthy flag
- `src/services/circuit-breaker.ts`: CircuitBreakerStatus type and getStatus() — already injected into health route
- `src/services/scheduler.ts`: Map<number, Cron> job registry — can be queried for next run times via croner API

### Established Patterns
- Factory functions for routes with dependency injection (createHealthRoute, createAgentRoutes)
- enrichAgent helper adds computed fields to raw DB agent rows
- Zod for all validation, Drizzle ORM for queries
- Count executions in JS after filtering (bounded result set pattern from Phase 4)

### Integration Points
- `src/db/schema.ts`: Add retryCount column to executionHistory table
- `src/services/executor.ts`: Pass retry count from callLlmWithRetry to DB recording
- `src/helpers/enrich-agent.ts`: Add healthy flag computation (query last 3 executions)
- `src/routes/health.ts`: Major enhancement — per-agent breakdown, aggregates, upcoming runs, status levels
- `src/routes/agents.ts`: Update default limit from 50 to 100

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 08-enhanced-health-monitoring-with-agent-health-flags-and-execution-diagnostics*
*Context gathered: 2026-03-15*
