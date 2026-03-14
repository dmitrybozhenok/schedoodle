# Phase 3: Management API and Scheduling - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

REST API for agent CRUD (create, read, update, delete) and cron-based automatic execution. Users manage agents via HTTP endpoints, and agents run automatically on their cron schedules. No auth, no circuit breakers, no email delivery — just the management interface and scheduler.

</domain>

<decisions>
## Implementation Decisions

### HTTP framework & routing
- Use Hono as the HTTP framework — lightweight, TypeScript-native, ESM-friendly
- All agent CRUD routes in a single file: src/routes/agents.ts, mounted on the Hono app
- Request bodies validated with Zod schemas (consistent with project's Zod-everywhere approach)
- Port 3000 by default, overridable via PORT env var (add to Zod env schema with default)

### Cron scheduling approach
- In-process cron library (node-cron, croner, or similar) — runs inside the same Node.js process
- Load all agents from DB at startup and register their cron schedules
- When an agent is created/updated/deleted via API, update the in-memory schedule immediately
- Log cron triggers and results to console (e.g., "[cron] Executing: Morning Briefing", "[cron] Morning Briefing: success in 3.2s")
- Single process: API server and scheduler both start in index.ts

### API response shape & errors
- Flat JSON responses, no envelope — success returns the resource directly, lists return arrays
- Error format: { error: string, details?: [{ field, message }] }
- Standard REST status codes: 400 (validation), 404 (not found), 409 (duplicate name), 500 (unexpected)
- Field-level validation error details from Zod error paths
- Separate GET /agents/:id/executions endpoint for execution history per agent

### Agent lifecycle & validation
- Validate cron expressions on create/update — reject invalid expressions with 400
- On update (PATCH): reschedule the cron job immediately when schedule changes
- On delete: cancel the cron job, delete the agent row, keep execution history (no cascade)
- Support PATCH with partial fields for updates (don't require resending unchanged fields)

### Claude's Discretion
- Specific cron library choice (node-cron vs croner vs other)
- Hono middleware patterns (error handler, logger)
- Execution history pagination/limit strategy
- How to handle the foreign key constraint when deleting agents (nullable FK or ON DELETE SET NULL)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/executor.ts`: `executeAgent(agent, db)` and `executeAgents(agents, db)` — scheduler calls these directly
- `src/db/schema.ts`: agents and executionHistory tables with all needed columns
- `src/types/index.ts`: Agent, NewAgent, Execution, NewExecution types
- `src/config/env.ts`: Zod-validated config — add PORT here
- `src/db/index.ts`: Database connection export
- `src/schemas/agent-output.ts`: Shared output schema (AgentOutput type)

### Established Patterns
- Zod v4 for all validation (config, output schemas — now also request bodies)
- ESM with .js extensions in all imports
- Biome for linting/formatting
- Layer-based structure: src/config/, src/db/, src/services/, src/types/
- Plain functions for services (not classes)
- `.returning().get()` for synchronous Drizzle insert returning

### Integration Points
- `src/routes/agents.ts` (new) imports db, schema, types
- `src/services/scheduler.ts` (new) imports executeAgent from executor, agents from schema
- `src/index.ts` transforms from simple startup script to Hono HTTP server + scheduler init
- `src/config/env.ts` needs PORT added to Zod schema

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-management-api-and-scheduling*
*Context gathered: 2026-03-14*
