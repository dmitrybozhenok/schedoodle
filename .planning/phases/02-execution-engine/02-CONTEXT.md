# Phase 2: Execution Engine - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Core LLM execution pipeline — sending agent tasks to Claude via Vercel AI SDK, validating structured output with Zod, pre-fetching external data from URLs in the task description, and handling failures gracefully. No API endpoints, no scheduling, no circuit breakers — just the execution function that Phase 3 will call.

</domain>

<decisions>
## Implementation Decisions

### LLM SDK & calling pattern
- Use Vercel AI SDK with generateObject() for structured output in one call
- Agent's systemPrompt field maps to the LLM system message; task description maps to the user message
- Execution service is a plain function: executeAgent(agent, db) in src/services/executor.ts — stateless, easy to test
- Model is configurable per-agent via a 'model' column on the agents table (default: claude-sonnet-4-20250514)

### Data pre-fetch behavior
- URLs are extracted inline from the agent's task description (no separate DB column)
- 10-second timeout per URL fetch
- On fetch failure: skip the URL and include a note in the LLM context (e.g., "[Failed to fetch https://... — connection timeout]") — agent still executes with whatever data is available
- Strip HTML from web pages, pass as plain text; pass JSON API responses as raw JSON

### Structured output & schemas
- Single shared Zod schema for all agents in v1: { summary: string, details: string, data?: unknown }
- Per-agent schemas deferred to v2 (EXEC-06)
- On Zod validation failure: retry the LLM call once with the validation error as feedback; if second attempt fails, mark execution as 'failure' with the Zod error in the error column
- Store the validated result as JSON in the existing execution_history.result column

### Failure & concurrency model
- Status transitions: insert a 'running' record before the LLM call, update to 'success' or 'failure' when done
- Multiple agents run concurrently via Promise.allSettled — each resolves independently, one failure doesn't affect others
- Measure wall-clock execution time (pre-fetch + LLM call) in milliseconds, store in duration_ms column
- Extract token counts (inputTokens, outputTokens) from the Vercel AI SDK response and store in existing columns

### Claude's Discretion
- URL extraction implementation (regex vs URL parsing)
- HTML-to-text library choice
- Exact error message formatting in the error column
- How pre-fetched data is formatted in the LLM context prompt

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config/env.ts`: Zod-validated config with ANTHROPIC_API_KEY already available
- `src/db/schema.ts`: executionHistory table with all needed columns (status, tokens, duration, result JSON, error)
- `src/types/index.ts`: Agent, NewAgent, Execution, NewExecution types inferred from Drizzle schema
- `src/db/index.ts`: Database connection export

### Established Patterns
- Zod v4 for validation (config module uses it — same library for output schemas)
- ESM with .js extensions in all imports
- Biome for linting/formatting
- Layer-based structure: src/config/, src/db/, src/services/, src/types/

### Integration Points
- `src/services/executor.ts` (new) imports db from `src/db/index.js` and types from `src/types/index.js`
- `src/db/schema.ts` needs a new 'model' column on agents table
- Entry point `src/index.ts` can import executor for manual testing

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-execution-engine*
*Context gathered: 2026-03-14*
