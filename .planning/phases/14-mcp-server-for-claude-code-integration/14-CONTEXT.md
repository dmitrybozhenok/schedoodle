# Phase 14: MCP Server for Claude Code Integration - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose Schedoodle's full management capabilities through an MCP (Model Context Protocol) server so Claude Code can manage agents, check status, trigger executions, and manage tools directly from the CLI. The MCP server runs as a separate stdio process, accesses the database directly, and mirrors the REST API's operation set as MCP tools.

</domain>

<decisions>
## Implementation Decisions

### Transport & deployment
- stdio transport — standard MCP pattern for CLI tools, zero network config
- Separate entrypoint at `src/mcp.ts` — not integrated into the Hono HTTP server
- Direct DB access — imports services and db modules directly, same pattern as the scheduler
- No scheduler — MCP server only does on-demand operations, scheduling stays with the main server process
- Manual setup documentation — README instructions for adding to `.claude.json` or `claude_desktop_config.json`

### MCP surface area
- Tools only — no Resources or Prompts primitives
- 1:1 mapping between REST API endpoints and MCP tools (list_agents, get_agent, create_agent, etc.)
- Full management suite — mirror the entire REST API: agent CRUD, execute, health, schedule parsing, tool management, execution history
- Natural language schedule input supported — create_agent and update_agent accept human-readable schedules via the schedule-parser service

### Operation scope
- Destructive operations (delete_agent, delete_tool) return a preview of what would be deleted and require a second call to confirm
- No auth — MCP server bypasses AUTH_TOKEN since it accesses DB directly via stdio (no HTTP layer)
- Synchronous execution — execute_agent waits for the LLM call to finish and returns the result (may take 10-60s for tool-using agents)
- No scheduler startup — avoids dual-process cron conflicts and SQLite write contention

### Output formatting
- Structured JSON responses matching REST API response shapes
- Full output — no truncation of execution results
- List operations return all items (no pagination) — personal tool with limited agents
- Error responses include guidance for fixing the issue (e.g., "Agent not found (ID: abc). Use list_agents to see available agents.")

### Claude's Discretion
- MCP SDK library choice (@modelcontextprotocol/sdk or alternative)
- Exact tool naming convention (snake_case confirmed by 1:1 mapping pattern)
- How the preview-before-delete confirmation flow works internally
- Whether to add a package.json bin entry for the MCP server
- Test strategy for MCP tools (unit tests on handler functions vs MCP protocol-level tests)

</decisions>

<specifics>
## Specific Ideas

- The MCP server should feel like a complete CLI control plane for Schedoodle — anything you can do via curl, you can do via Claude Code
- Error guidance pattern: every error should help Claude self-correct (suggest the right tool to call next)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/executor.ts`: executeAgent() — call directly for synchronous execution
- `src/services/scheduler.ts`: getScheduledJobs() — query upcoming runs for health/status
- `src/services/schedule-parser.ts`: parseSchedule() — natural language to cron conversion
- `src/services/startup.ts`: cleanup utilities reusable at MCP startup
- `src/routes/agents.ts`: createAgentRoutes() — business logic patterns to mirror
- `src/routes/tools.ts`: createToolRoutes() — tool CRUD patterns to mirror
- `src/routes/health.ts`: createHealthRoute() — health data aggregation logic
- `src/db/schema.ts`: agents, executionHistory, tools, agentTools tables
- `src/config/env.ts`: Zod-validated env config — MCP server needs DB_PATH at minimum

### Established Patterns
- Zod v4 for all validation (input schemas for MCP tool parameters)
- Plain functions for services (not classes)
- ESM with .js extensions, Biome for formatting
- Factory functions for dependency injection (createAgentRoutes(db))
- enrichAgent pattern for computed fields on agent responses

### Integration Points
- `src/mcp.ts` (new) — MCP server entrypoint with stdio transport
- `src/mcp/tools/` (new) — MCP tool handler functions, importing from services/db
- `package.json` — new script entry for running MCP server (e.g., `mcp` or `mcp:start`)
- `src/db/index.ts` — shared database connection

</code_context>

<deferred>
## Deferred Ideas

- HTTP/SSE transport for remote MCP access — add if needed for non-local use cases
- MCP Resources primitive for browsable agent data — evaluate after tools-only is shipped
- MCP Prompts primitive for reusable agent creation templates — future enhancement
- Scheduler integration in MCP server — would allow running Schedoodle entirely via Claude Code

</deferred>

---

*Phase: 14-mcp-server-for-claude-code-integration*
*Context gathered: 2026-03-15*
