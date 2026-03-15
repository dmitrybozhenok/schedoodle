# Phase 9: Agent Tool Use with Built-in and Custom Tools - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable agents to use tools (functions) during LLM execution. Ships two built-in tools (web_fetch, web_search) available to all agents, plus a custom webhook tool system where users define HTTP-based tools via API. The existing pre-fetch pattern (URLs extracted from task descriptions) remains — tool use extends it with dynamic, LLM-driven data gathering. No agent chaining, no code execution tools, no streaming.

</domain>

<decisions>
## Implementation Decisions

### Tool scope & types
- Two built-in tools ship by default: `web_fetch` (fetch a URL, return content) and `web_search` (Brave Search API, return structured results)
- Built-in tools are automatically available to all agents — no per-agent opt-in needed
- Custom tools are HTTP webhook tools: user defines URL, method, headers, and JSON Schema for input
- Pre-fetch pattern (Phase 2) stays for URLs in task descriptions; tool use extends it for URLs the LLM discovers during reasoning
- Both built-in and custom webhook tools in this phase

### Tool definition model
- Separate `tools` table in the database with its own schema (id, name, description, url, method, headers, inputSchema)
- Many-to-many join table links tools to agents (tools are reusable across agents)
- Full CRUD API at `/tools` (POST, GET, PATCH, DELETE)
- Attach tools to agents via POST /agents/:id/tools/:toolId (or similar)
- Tool input schema defined as standard JSON Schema object (works directly with Vercel AI SDK tool() function)

### Execution loop
- Use Vercel AI SDK `generateText` with built-in `maxSteps` parameter (set to 10)
- SDK handles the tool call loop automatically: calls tools, feeds results back, repeats until done or max steps
- Circuit breaker wraps the entire `generateText` call (all tool steps count as one breaker event)
- Tool call details are logged: store array of {toolName, input, output, durationMs} in execution history for observability

### Safety & limits
- Configurable per-agent execution timeout (default 60s), separate from the per-URL 10s fetch timeout
- New `maxExecutionMs` column on agents table (nullable, default 60000)
- No per-step limit on parallel tool calls — maxSteps (10) caps total iterations
- Webhook tools support static headers for auth (Bearer tokens, API keys stored in tools table)
- Brave Search API key via environment variable (BRAVE_API_KEY), same pattern as ANTHROPIC_API_KEY and RESEND_API_KEY

### Claude's Discretion
- Exact join table design for agent-tool relationships
- How tool call logs are stored (JSON column vs separate table)
- Brave Search API response parsing/formatting
- How `maxSteps` interacts with the existing validation retry logic
- AbortController implementation for per-agent timeout budget
- web_fetch tool implementation detail (reuse prefetch.ts logic vs new implementation)

</decisions>

<specifics>
## Specific Ideas

- PROJECT.md originally listed "LLM tool-use / function-calling loops" as out of scope for v1 — this phase explicitly reverses that decision for v2
- The Brave Search free tier allows 1 req/sec and 2000 queries/month, which is fine for a personal tool
- Tool call logging enables debugging "what did the agent actually do" which is valuable for scheduled background agents

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/prefetch.ts`: extractUrls(), prefetchUrls(), buildPrompt() — URL fetching logic can be reused for web_fetch tool implementation
- `src/services/executor.ts`: callLlmWithRetry() uses generateText with Output.object — needs modification to add tools + maxSteps
- `src/services/circuit-breaker.ts`: wraps LLM calls — keep wrapping the whole generateText call
- `src/config/env.ts`: Zod-validated env config — add BRAVE_API_KEY here
- `src/schemas/agent-output.ts`: agentOutputSchema — still used for final structured output
- `src/db/schema.ts`: agents and executionHistory tables — need new tools table + join table + maxExecutionMs column

### Established Patterns
- Zod v4 for all validation
- Hono with factory functions (createAgentRoutes(db)) for route DI
- Plain functions for services (not classes)
- ESM with .js extensions, Biome for formatting
- zodErrorHook for consistent 400 error responses
- enrichAgent pattern for computed fields on API responses

### Integration Points
- `src/services/executor.ts`: Main modification point — add tools to generateText call
- `src/db/schema.ts`: New tools table, agent_tools join table, maxExecutionMs on agents
- `src/routes/`: New tools.ts route file, update agents.ts for tool attachment
- `src/config/env.ts`: Add BRAVE_API_KEY (optional, like RESEND vars)
- `src/index.ts`: Mount new tools routes

</code_context>

<deferred>
## Deferred Ideas

- Shell command / code execution tool — security implications need separate design
- Per-agent tool opt-out for built-ins — all agents get built-ins for now
- Tool authentication beyond static headers (OAuth, dynamic tokens)
- Per-agent maxSteps override — fixed at 10 for now
- Tool marketplace / sharing — no users to share with

</deferred>

---

*Phase: 09-agent-tool-use-with-built-in-and-custom-tools*
*Context gathered: 2026-03-15*
