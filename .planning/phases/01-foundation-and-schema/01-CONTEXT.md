# Phase 1: Foundation and Schema - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Project scaffold, database schema, agent persistence, and configuration validation. Sets up the TypeScript project, SQLite database with Drizzle ORM, and validates environment config at startup. No API endpoints, no LLM calls, no scheduling — just the foundation that all future phases build on.

</domain>

<decisions>
## Implementation Decisions

### Agent identity model
- Auto-increment integer primary key for DB relations
- Agent name is a separate display field, must be unique (case-insensitive)
- Freeform text names allowed ("Morning Briefing", "dep-watch", etc.)
- No enabled/disabled status field — deferred to v2 (AGNT-05)
- Include created_at and updated_at timestamp columns

### Execution history fields
- Track input_tokens and output_tokens separately (different pricing per direction)
- Store full LLM result as JSON column — enables reviewing past results, debugging, email re-sends
- Status enum: success / failure / running (three states cover the lifecycle)
- Error details in a separate error column
- Keep all history, no retention limit — SQLite handles it fine for personal use

### Startup & config behavior
- Crash with clear error on missing required config — fail fast, no silent fallbacks
- Config from .env file (dotenv) with environment variable overrides
- Phase 1 validates: DATABASE_URL (or path) and ANTHROPIC_API_KEY only
- Add more config validation as phases introduce new dependencies
- Database path has a sensible default (e.g., ./data/schedoodle.db), overridable via env

### Project layout
- Organize by layer: src/config/, src/db/, src/services/, src/types/, src/index.ts
- ESM modules ("type": "module" in package.json)
- Biome for linting and formatting from day one

### Claude's Discretion
- Dev runner choice (tsx watch vs alternatives)
- Exact Drizzle migration workflow
- Database column types and constraints beyond what's specified
- tsconfig settings
- Package manager choice

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no existing code

### Established Patterns
- None yet — this phase establishes the patterns

### Integration Points
- Database schema and config module will be imported by every future phase
- Drizzle schema definitions become the single source of truth for DB types

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-foundation-and-schema*
*Context gathered: 2026-03-14*
