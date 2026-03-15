# Phase 11: Data Integrity and Execution Lifecycle - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Harden data consistency (FK enforcement, indexes, WAL mode), handle stale execution records on startup, add execution history pruning, fix updatedAt tracking, and add a manual execution trigger endpoint. No new agent features, no new notification channels, no scheduling changes.

</domain>

<decisions>
## Implementation Decisions

### Stale execution cleanup
- On startup, mark all 'running' records as 'failure' with error 'Process terminated during execution'
- Set completedAt to process start time; leave durationMs null (can't know actual duration)
- Console log the count: '[startup] Cleaned up N stale running executions'
- No periodic cleanup — startup-only is sufficient for a single-process architecture

### History retention
- Age-based pruning: delete execution_history records older than N days
- Default retention: 30 days, configurable via RETENTION_DAYS env var (optional, in env.ts)
- Run pruning on startup (after stale cleanup)
- Console log: '[startup] Pruned N execution records older than 30 days'

### FK & index hardening
- Enable PRAGMA foreign_keys = ON on every database connection
- Enable PRAGMA journal_mode = WAL for concurrent read/write performance
- Add indexes on execution_history: agent_id (FK lookups), composite agent_id+startedAt (history queries), status (stale cleanup)
- Fix updatedAt on agents table: set updatedAt = new Date().toISOString() in PATCH handler (application code, not trigger)
- Also fix updatedAt on tools table PATCH handler (same pattern)

### Manual execution trigger
- POST /agents/:id/execute — triggers immediate execution of an agent
- Returns result inline (waits for completion, may take 10-60s)
- Only enabled agents can be manually executed (return 409 if disabled)
- Sends notifications same as scheduled execution (consistent behavior)
- Pulls in v2 requirement EXEC-05

### Claude's Discretion
- Exact startup function orchestration (order of stale cleanup → pruning → scheduler start)
- Index naming conventions
- Whether to add PRAGMA pragmas via better-sqlite3 connection options or manual exec
- Error response format for 409 on disabled agent execute

</decisions>

<specifics>
## Specific Ideas

- Startup sequence should be: FK/WAL pragmas → stale cleanup → history pruning → scheduler start
- The stale cleanup and pruning should be simple synchronous DB operations before the scheduler starts

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/db/index.ts`: Database connection — add PRAGMAs here
- `src/services/executor.ts`: executeAgent() — reuse for manual trigger endpoint
- `src/routes/agents.ts`: PATCH handler — add updatedAt fix here
- `src/routes/tools.ts`: PATCH handler — add updatedAt fix here
- `src/config/env.ts`: Zod env config — add RETENTION_DAYS here
- `src/db/schema.ts`: executionHistory table — add indexes here
- `src/index.ts`: Server startup — add startup tasks here

### Established Patterns
- Zod v4 for env validation with optional fields (coerce + default pattern)
- Factory functions for routes (createAgentRoutes(db))
- Console.error/log for operational messages
- Synchronous DB operations via better-sqlite3
- enrichAgent pattern for computed response fields

### Integration Points
- `src/db/index.ts`: PRAGMAs on connection creation
- `src/index.ts`: Startup sequence (stale cleanup, pruning, then scheduler)
- `src/routes/agents.ts`: New POST /:id/execute endpoint + updatedAt fix in PATCH
- `src/routes/tools.ts`: updatedAt fix in PATCH
- `src/config/env.ts`: RETENTION_DAYS optional env var

</code_context>

<deferred>
## Deferred Ideas

- SCHD-03 (catch-up on missed schedules) — decided against for now
- EXEC-07 (dry-run mode) — skipped, manual execute is sufficient
- Periodic pruning (daily cron) — startup-only for now, add if needed
- EXEC-06 (per-agent Zod output schemas) — still v2

</deferred>

---

*Phase: 11-data-integrity-and-execution-lifecycle*
*Context gathered: 2026-03-15*
