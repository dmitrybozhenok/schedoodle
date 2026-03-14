# Phase 6: Agent Enabled Flag and Schedule Controls - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Add an enabled/disabled toggle to agents (v2 requirement AGNT-05) and enrich agent responses with schedule metadata (nextRunAt, lastRunAt). Disabled agents stop running on their cron schedule but can still be manually executed. No pause-until-date, no run-once mode, no new notification features.

</domain>

<decisions>
## Implementation Decisions

### Enable/disable behavior
- Disabled agents do NOT have cron jobs registered — silent skip, no log noise
- Disabled agents CAN still be manually executed via POST /:id/execute
- Toggle is a boolean `enabled` field on the agents table
- New agents default to enabled (matches current behavior)
- Enable/disable via PATCH /agents/:id { enabled: true/false } — no dedicated endpoints

### Schedule metadata
- Add computed `nextRunAt` field to agent responses (from croner's nextRun())
- Add computed `lastRunAt` field to agent responses (latest execution_history row)
- `nextRunAt` returns null for disabled agents — unambiguous signal that agent won't run
- Both fields included in GET /agents list and GET /agents/:id detail responses

### API response changes
- GET /agents supports ?enabled=true or ?enabled=false query param for filtering
- `enabled` field accepted in POST /agents create body (optional, defaults to true)
- PATCH response returns updated agent with enabled status and nextRunAt/lastRunAt — no extra status message
- Standard flat JSON response pattern maintained

### Startup & migration
- ALTER TABLE adds `enabled` column with DEFAULT 1 (true) — all existing agents continue running
- At startup, only enabled agents are loaded into the scheduler (WHERE enabled = 1)
- Startup log shows both counts: "[cron] Scheduled 3 agent(s), 2 disabled"
- PATCH { enabled: true } immediately registers the cron job (consistent with existing reschedule-on-update behavior)
- PATCH { enabled: false } immediately removes the cron job

### Claude's Discretion
- How lastRunAt is computed (subquery vs join vs separate query)
- Croner API usage for nextRun() computation
- Migration approach (Drizzle push vs manual ALTER TABLE)
- Test strategy for scheduler enable/disable behavior

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/db/schema.ts`: agents table — add `enabled` integer column (SQLite boolean)
- `src/services/scheduler.ts`: `scheduleAgent()`, `removeAgent()`, `startAll()` — modify to check enabled status
- `src/routes/agents.ts`: `createAgentRoutes()` — add enabled to PATCH handling, add filtering to GET list
- `src/schemas/agent-input.ts`: `createAgentSchema`, `updateAgentSchema` — add optional `enabled` field
- `croner` library already imported — has `.nextRun()` method for computing next execution time

### Established Patterns
- Zod v4 for all validation (config, input schemas, output schemas)
- PATCH with partial fields via `updateAgentSchema.partial()`
- Scheduler re-reads agent from DB on each cron trigger
- Factory function pattern for route DI (`createAgentRoutes(db)`)
- `.returning().get()` for synchronous Drizzle insert/update returning

### Integration Points
- `src/db/schema.ts` — add `enabled` column to agents table
- `src/services/scheduler.ts` — `startAll()` filters by enabled; `scheduleAgent()` and `removeAgent()` called on PATCH toggle
- `src/routes/agents.ts` — PATCH handler checks enabled change and schedules/removes accordingly; GET list adds filtering
- `src/index.ts` — startup query filters to enabled agents only
- `src/schemas/agent-input.ts` — add `enabled` to create and update schemas

</code_context>

<deferred>
## Deferred Ideas

- Pause-until-date (auto-re-enable at future time) — separate feature, adds timer complexity
- Run-once mode — different scheduling paradigm, not in scope

</deferred>

---

*Phase: 06-agent-enabled-flag-and-schedule-controls*
*Context gathered: 2026-03-14*
