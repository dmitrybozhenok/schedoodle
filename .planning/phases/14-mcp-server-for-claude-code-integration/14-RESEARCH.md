# Phase 14: MCP Server for Claude Code Integration - Research

**Researched:** 2026-03-15
**Domain:** Model Context Protocol (MCP) server, stdio transport, tool registration
**Confidence:** HIGH

## Summary

This phase adds an MCP (Model Context Protocol) server to Schedoodle, exposing the full management API as MCP tools so Claude Code can manage agents, trigger executions, inspect health, and manage custom tools directly from the CLI. The server runs as a separate stdio process (entrypoint at `src/mcp.ts`), accesses the database directly (same pattern as the scheduler), and mirrors the REST API's operation set as MCP tools.

The official TypeScript SDK `@modelcontextprotocol/sdk` v1.27.1 is the stable choice. It supports Zod v4 (project uses v4.3.6, compatibility confirmed since SDK v1.25.0), uses ESM imports with `.js` extensions (matching project conventions), and provides `McpServer` + `StdioServerTransport` as the high-level API. The SDK is a peer dependency on `zod` so no additional Zod install is needed.

**Primary recommendation:** Use `@modelcontextprotocol/sdk` v1.27.1 with `McpServer` high-level API, register all tools with `server.registerTool()` using Zod schemas for inputSchema, connect via `StdioServerTransport`, and structure tool handlers as thin wrappers calling existing service functions and DB queries directly.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- stdio transport -- standard MCP pattern for CLI tools, zero network config
- Separate entrypoint at `src/mcp.ts` -- not integrated into the Hono HTTP server
- Direct DB access -- imports services and db modules directly, same pattern as the scheduler
- No scheduler -- MCP server only does on-demand operations, scheduling stays with the main server process
- Manual setup documentation -- README instructions for adding to `.claude.json` or `claude_desktop_config.json`
- Tools only -- no Resources or Prompts primitives
- 1:1 mapping between REST API endpoints and MCP tools (list_agents, get_agent, create_agent, etc.)
- Full management suite -- mirror the entire REST API: agent CRUD, execute, health, schedule parsing, tool management, execution history
- Natural language schedule input supported -- create_agent and update_agent accept human-readable schedules via the schedule-parser service
- Destructive operations (delete_agent, delete_tool) return a preview of what would be deleted and require a second call to confirm
- No auth -- MCP server bypasses AUTH_TOKEN since it accesses DB directly via stdio (no HTTP layer)
- Synchronous execution -- execute_agent waits for the LLM call to finish and returns the result (may take 10-60s for tool-using agents)
- No scheduler startup -- avoids dual-process cron conflicts and SQLite write contention
- Structured JSON responses matching REST API response shapes
- Full output -- no truncation of execution results
- List operations return all items (no pagination) -- personal tool with limited agents
- Error responses include guidance for fixing the issue

### Claude's Discretion
- MCP SDK library choice (@modelcontextprotocol/sdk or alternative)
- Exact tool naming convention (snake_case confirmed by 1:1 mapping pattern)
- How the preview-before-delete confirmation flow works internally
- Whether to add a package.json bin entry for the MCP server
- Test strategy for MCP tools (unit tests on handler functions vs MCP protocol-level tests)

### Deferred Ideas (OUT OF SCOPE)
- HTTP/SSE transport for remote MCP access
- MCP Resources primitive for browsable agent data
- MCP Prompts primitive for reusable agent creation templates
- Scheduler integration in MCP server
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | ^1.27.1 | MCP server framework | Official TypeScript SDK, stable v1.x, Zod v4 compatible since v1.25.0 |
| zod | ^4.3.6 (existing) | Input schema validation | Already in project; SDK has peer dep on `zod ^3.25 \|\| ^4.0` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | ^12.8.0 (existing) | Database access | MCP server imports `src/db/index.ts` directly |
| drizzle-orm | ^0.45.1 (existing) | Query builder | Same DB queries as routes |
| tsx | ^4.21.0 (existing) | TypeScript execution | Dev-mode MCP server runner |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @modelcontextprotocol/sdk (v1.x) | @modelcontextprotocol/server (v2 alpha) | v2 still alpha, not published as latest on npm; v1.27.1 is stable and production-ready |
| McpServer high-level API | Low-level Server class | McpServer provides registerTool with Zod schema validation built in; low-level Server requires manual JSON Schema conversion |

**Installation:**
```bash
pnpm add @modelcontextprotocol/sdk
```

**Recommendation for discretion items:**
- **SDK choice:** Use `@modelcontextprotocol/sdk` v1.27.1 (stable, Zod v4 compatible, well-documented)
- **Tool naming:** Use `snake_case` (e.g., `list_agents`, `create_agent`, `delete_agent`) -- matches MCP convention and the 1:1 API mapping pattern
- **Confirmation flow:** Two-tool pattern: `delete_agent` with `confirm: false` (default) returns preview; second call with `confirm: true` executes deletion
- **bin entry:** Yes, add a `"mcp"` bin entry in package.json pointing to `dist/mcp.js` for easy `node dist/mcp.js` invocation
- **Test strategy:** Unit tests on handler logic (mocking DB), not MCP protocol-level tests. The handlers are thin wrappers; test the business logic they call.

## Architecture Patterns

### Recommended Project Structure
```
src/
  mcp.ts                    # MCP server entrypoint (stdio transport)
  mcp/
    tools/
      agents.ts             # Agent CRUD + execute tool handlers
      tools.ts              # Custom tool CRUD handlers
      health.ts             # Health check tool handler
      schedules.ts          # Schedule parsing tool handler
      history.ts            # Execution history tool handler
    helpers.ts              # Shared MCP response formatting utilities
```

### Pattern 1: MCP Server Entrypoint
**What:** Single-file entrypoint that creates McpServer, registers all tools, connects stdio transport.
**When to use:** Always -- this is the MCP server's main function.
**Example:**
```typescript
// Source: Official MCP SDK docs + project pattern
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Import DB directly (same as scheduler pattern)
import { db } from "./db/index.js";

// Import tool registration functions
import { registerAgentTools } from "./mcp/tools/agents.js";
import { registerToolTools } from "./mcp/tools/tools.js";
import { registerHealthTools } from "./mcp/tools/health.js";
import { registerScheduleTools } from "./mcp/tools/schedules.js";
import { registerHistoryTools } from "./mcp/tools/history.js";

const server = new McpServer({
  name: "schedoodle",
  version: "1.0.0",
});

// Register all tool groups
registerAgentTools(server, db);
registerToolTools(server, db);
registerHealthTools(server, db);
registerScheduleTools(server);
registerHistoryTools(server, db);

// Connect stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mcp] Schedoodle MCP server running on stdio");
```

### Pattern 2: Tool Registration Functions
**What:** Each domain (agents, tools, health, etc.) exports a `registerXTools(server, db)` function that registers related MCP tools.
**When to use:** For organizing tools by domain, matching the project's factory function pattern.
**Example:**
```typescript
// Source: Official MCP SDK server.md + project conventions
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "../../db/index.js";
import { agents } from "../../db/schema.js";
import { enrichAgent } from "../../helpers/enrich-agent.js";

export function registerAgentTools(server: McpServer, db: Database): void {
  server.registerTool(
    "list_agents",
    {
      title: "List Agents",
      description: "List all Schedoodle agents. Returns enriched agent data with health status, next run time, and consecutive failures.",
      inputSchema: z.object({
        enabled: z.enum(["true", "false"]).optional()
          .describe("Filter by enabled status. Omit to list all agents."),
      }),
    },
    async ({ enabled }) => {
      // ... handler logic using db queries and enrichAgent
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );
}
```

### Pattern 3: Two-Step Destructive Confirmation
**What:** Destructive operations use a `confirm` boolean parameter. Default (false) returns a preview. Second call with `confirm: true` performs the deletion.
**When to use:** For `delete_agent` and `delete_tool`.
**Example:**
```typescript
server.registerTool(
  "delete_agent",
  {
    title: "Delete Agent",
    description: "Delete an agent. First call shows what will be deleted. Call again with confirm=true to execute deletion.",
    inputSchema: z.object({
      id: z.number().describe("Agent ID to delete"),
      confirm: z.boolean().default(false)
        .describe("Set to true to confirm deletion. Default shows preview only."),
    }),
    annotations: {
      destructiveHint: true,
    },
  },
  async ({ id, confirm }) => {
    const agent = db.select().from(agents).where(eq(agents.id, id)).get();
    if (!agent) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          error: "Agent not found",
          guidance: `Agent with ID ${id} does not exist. Use list_agents to see available agents.`,
        }) }],
        isError: true,
      };
    }

    if (!confirm) {
      const enriched = enrichAgent(agent, db);
      return {
        content: [{ type: "text", text: JSON.stringify({
          action: "delete_agent",
          preview: enriched,
          message: `This will permanently delete agent "${agent.name}" (ID: ${id}) and all its tool attachments. Call delete_agent again with confirm=true to proceed.`,
        }) }],
      };
    }

    // Actually delete
    removeAgent(id);
    db.delete(agents).where(eq(agents.id, id)).run();
    return {
      content: [{ type: "text", text: JSON.stringify({
        deleted: true,
        agentId: id,
        agentName: agent.name,
      }) }],
    };
  },
);
```

### Pattern 4: Error Response with Guidance
**What:** Every error response includes actionable guidance for Claude to self-correct.
**When to use:** All tool error paths.
**Example:**
```typescript
// Error with guidance pattern
return {
  content: [{ type: "text", text: JSON.stringify({
    error: "Agent not found",
    id: requestedId,
    guidance: "Use list_agents to see available agents and their IDs.",
  }) }],
  isError: true,
};
```

### Pattern 5: DB Connection Without Scheduler
**What:** MCP server imports `db` from `src/db/index.ts` directly but never starts the scheduler or HTTP server.
**When to use:** Always -- the MCP server is a separate process that only does on-demand operations.
**Critical:** The `db/index.ts` module also imports `config/env.ts` which calls `process.exit(1)` on invalid config. The MCP server must have valid env vars set (at minimum `DATABASE_URL` and either `ANTHROPIC_API_KEY` or `LLM_PROVIDER=ollama`).

### Anti-Patterns to Avoid
- **console.log() in stdio server:** Never use `console.log()` in the MCP entrypoint or any code called from it. stdout is the MCP transport channel. Use `console.error()` for all logging.
- **Starting the scheduler from MCP:** Would cause dual-process cron conflicts and SQLite write contention.
- **Importing src/index.ts:** This starts the HTTP server and scheduler. MCP must have its own separate entrypoint.
- **Custom JSON Schema conversion:** Don't hand-roll JSON Schema from Zod -- the SDK handles `z.object()` to JSON Schema conversion via `registerTool`.
- **Truncating execution results:** The user decided full output, no truncation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON-RPC protocol | Custom stdio JSON-RPC handler | `StdioServerTransport` from SDK | Handles framing, parsing, error codes, protocol negotiation |
| Tool schema definition | Manual JSON Schema objects | `z.object()` in `registerTool` inputSchema | SDK converts Zod to JSON Schema automatically |
| Tool listing/discovery | Custom tools/list handler | `McpServer.registerTool()` | SDK handles tools/list, tool schema introspection |
| Protocol capability negotiation | Custom initialize handler | `McpServer` constructor | SDK handles MCP handshake, capabilities, version negotiation |
| Error code mapping | Custom error types | `isError: true` in tool result + descriptive text | MCP protocol defines error reporting in tool results |

**Key insight:** The MCP SDK handles all protocol-level concerns. Tool handlers are just async functions that receive validated input and return `{ content: [{ type: "text", text: string }] }`. The complexity is in the protocol, not the handlers.

## Common Pitfalls

### Pitfall 1: console.log corrupts stdio transport
**What goes wrong:** Any `console.log()` call writes to stdout, which is the MCP JSON-RPC channel. This corrupts messages and breaks the connection.
**Why it happens:** Developers forget that stdout is reserved for protocol communication.
**How to avoid:** Use `console.error()` for all logging in the MCP server. Grep for `console.log` in any imported module.
**Warning signs:** MCP client shows connection errors, tools fail silently, malformed JSON-RPC errors.

### Pitfall 2: env.ts calls process.exit on invalid config
**What goes wrong:** The MCP server imports `db/index.ts` which imports `config/env.ts`. If required env vars are missing (e.g., `ANTHROPIC_API_KEY` when `LLM_PROVIDER=anthropic`), `env.ts` calls `process.exit(1)` immediately.
**Why it happens:** `env.ts` was designed for the HTTP server where failing fast is appropriate.
**How to avoid:** Ensure the MCP server's launch configuration includes all required env vars. Document this clearly in setup instructions. Consider whether execute_agent (which needs LLM) should gracefully handle missing API keys.
**Warning signs:** MCP server exits immediately on startup with no output.

### Pitfall 3: Zod v4 inputSchema shape
**What goes wrong:** Using `z.discriminatedUnion()` or other non-object Zod types silently gets dropped by the SDK's `normalizeObjectSchema`.
**Why it happens:** The SDK's `registerTool` only reliably handles `z.object()` or record shapes for inputSchema.
**How to avoid:** Always use `z.object()` for inputSchema. Confirmed working with Zod v4.3.6 and SDK v1.27.1. Add `.describe()` to each field for good tool documentation.
**Warning signs:** Tool appears with empty parameters in Claude.

### Pitfall 4: Long-running execute_agent blocks stdio
**What goes wrong:** `execute_agent` can take 10-60s. During this time, the stdio connection appears frozen to the client.
**Why it happens:** MCP tool calls are synchronous from the client's perspective.
**How to avoid:** This is expected behavior per user decisions (synchronous execution). Document that execute_agent may take significant time. The MCP SDK handles keep-alive at the protocol level.
**Warning signs:** Client timeout if configured too aggressively. The SDK default should handle this.

### Pitfall 5: Database path resolution
**What goes wrong:** MCP server runs from a different working directory than the HTTP server, causing the relative `./data/schedoodle.db` path to resolve to the wrong location.
**Why it happens:** Claude Code spawns the MCP process, and the cwd might differ from the project root.
**How to avoid:** Use absolute path for `DATABASE_URL` in MCP configuration, or document that the `cwd` in the MCP config must point to the project root.
**Warning signs:** MCP server creates a new empty database instead of connecting to the existing one.

### Pitfall 6: Module import side effects
**What goes wrong:** Importing `db/index.ts` triggers database creation and pragma execution. Importing `config/env.ts` triggers `process.env` validation. These happen at import time, not when you call functions.
**Why it happens:** The project uses module-level side effects (common Node.js pattern).
**How to avoid:** Accept this -- it's the project pattern. Ensure env vars are set before the MCP process starts (in the MCP config's env block).

## Code Examples

Verified patterns from official sources:

### MCP Server Entrypoint (src/mcp.ts)
```typescript
// Source: MCP SDK server.md + project conventions
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "schedoodle",
  version: "1.0.0",
});

// ... register tools ...

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] Schedoodle MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in MCP main():", error);
  process.exit(1);
});
```

### Tool with Zod inputSchema
```typescript
// Source: MCP SDK server.md registerTool API
server.registerTool(
  "get_agent",
  {
    title: "Get Agent",
    description: "Get a single agent by ID with enriched data (health status, next run time, schedule info).",
    inputSchema: z.object({
      id: z.number().describe("The agent ID"),
    }),
  },
  async ({ id }) => {
    const agent = db.select().from(agents).where(eq(agents.id, id)).get();
    if (!agent) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          error: "Agent not found",
          id,
          guidance: "Use list_agents to see available agents and their IDs.",
        }) }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(enrichAgent(agent, db)) }],
    };
  },
);
```

### Claude Code MCP Configuration (.mcp.json)
```json
{
  "mcpServers": {
    "schedoodle": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/schedoodle/src/mcp.ts"],
      "env": {
        "DATABASE_URL": "/absolute/path/to/schedoodle/data/schedoodle.db",
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}",
        "LLM_PROVIDER": "anthropic"
      }
    }
  }
}
```

### Tool Annotations for Destructive Operations
```typescript
// Source: MCP specification for tool annotations
server.registerTool(
  "delete_tool",
  {
    title: "Delete Tool",
    description: "Delete a custom tool definition. Call without confirm to preview, with confirm=true to execute.",
    inputSchema: z.object({
      id: z.number().describe("Tool ID to delete"),
      confirm: z.boolean().default(false).describe("Set to true to confirm deletion"),
    }),
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  handler,
);
```

## Complete MCP Tool Surface Area

Based on REST API 1:1 mapping requirement:

| MCP Tool Name | REST Equivalent | Category |
|---------------|-----------------|----------|
| `list_agents` | GET /agents | Agent CRUD |
| `get_agent` | GET /agents/:id | Agent CRUD |
| `create_agent` | POST /agents | Agent CRUD |
| `update_agent` | PATCH /agents/:id | Agent CRUD |
| `delete_agent` | DELETE /agents/:id | Agent CRUD (destructive) |
| `execute_agent` | POST /agents/:id/execute | Execution |
| `get_execution_history` | GET /agents/:id/executions | History |
| `get_health` | GET /health | Health |
| `parse_schedule` | POST /schedules/parse | Schedules |
| `list_tools` | GET /tools | Tool CRUD |
| `get_tool` | GET /tools/:id | Tool CRUD |
| `create_tool` | POST /tools | Tool CRUD |
| `update_tool` | PATCH /tools/:id | Tool CRUD |
| `delete_tool` | DELETE /tools/:id | Tool CRUD (destructive) |
| `list_agent_tools` | GET /agents/:id/tools | Agent-Tool Links |
| `attach_tool` | POST /agents/:id/tools/:toolId | Agent-Tool Links |
| `detach_tool` | DELETE /agents/:id/tools/:toolId | Agent-Tool Links |

**Total: 17 tools** mirroring the full REST API surface.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual JSON Schema for tools | Zod schemas with auto-conversion | SDK v1.25.0 (Dec 2024) | Use z.object() directly in registerTool |
| Zod v3 only | Zod v3.25+ and v4 supported | SDK v1.25.0 (Dec 2024) | Project's Zod v4.3.6 works without changes |
| Low-level Server class | McpServer high-level API | SDK ~v1.10 | registerTool handles schema conversion, listing, routing |
| @modelcontextprotocol/sdk monolithic | @modelcontextprotocol/server (v2 split) | v2 alpha (2026) | v2 not stable yet; use v1.x @modelcontextprotocol/sdk |

**Deprecated/outdated:**
- `@modelcontextprotocol/server` v2 package: still alpha, not recommended for production
- Low-level `Server` class: functional but McpServer is simpler for tools-only servers
- `inputSchema` as plain record (non-z.object shape): works but z.object is safer for Zod v4

## Open Questions

1. **Should `execute_agent` check if the agent is disabled?**
   - What we know: The REST API returns 409 for disabled agents. The MCP tool should mirror this behavior.
   - Recommendation: Yes, check enabled status and return isError with guidance to enable the agent first.

2. **How to handle `env.ts` process.exit for MCP server?**
   - What we know: `env.ts` calls `process.exit(1)` on missing env vars. MCP server needs at least DATABASE_URL.
   - What's unclear: Whether to create a separate env loader for MCP or reuse existing one.
   - Recommendation: Reuse existing `env.ts` -- it correctly validates that required config is present. Document required env vars in setup instructions.

3. **Should the MCP server import scheduler functions?**
   - What we know: create_agent/update_agent in REST API call `scheduleAgent()`/`removeAgent()` from the scheduler.
   - What's unclear: MCP server decision says "no scheduler" -- but does that mean no scheduling at all, or just no auto-startup of scheduled jobs?
   - Recommendation: MCP tool create/update should NOT call scheduleAgent/removeAgent. The main HTTP server handles scheduling when it next starts. The MCP server only modifies DB state. This avoids dual-process cron conflicts entirely.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest v4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm vitest run tests/mcp` |
| Full suite command | `pnpm vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | MCP server starts with stdio transport | smoke | `pnpm vitest run tests/mcp-server.test.ts -t "starts"` | No -- Wave 0 |
| MCP-02 | list_agents returns all agents enriched | unit | `pnpm vitest run tests/mcp-agents.test.ts -t "list"` | No -- Wave 0 |
| MCP-03 | create_agent with NL schedule | unit | `pnpm vitest run tests/mcp-agents.test.ts -t "create"` | No -- Wave 0 |
| MCP-04 | delete_agent confirmation flow | unit | `pnpm vitest run tests/mcp-agents.test.ts -t "delete"` | No -- Wave 0 |
| MCP-05 | Error responses include guidance | unit | `pnpm vitest run tests/mcp-agents.test.ts -t "error"` | No -- Wave 0 |
| MCP-06 | Tool CRUD operations | unit | `pnpm vitest run tests/mcp-tools.test.ts` | No -- Wave 0 |
| MCP-07 | Health tool returns system status | unit | `pnpm vitest run tests/mcp-health.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run tests/mcp*.test.ts`
- **Per wave merge:** `pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/mcp-agents.test.ts` -- agent CRUD tool handler tests
- [ ] `tests/mcp-tools.test.ts` -- tool CRUD tool handler tests
- [ ] `tests/mcp-health.test.ts` -- health tool handler tests
- [ ] SDK install: `pnpm add @modelcontextprotocol/sdk` -- new dependency

**Test approach:** Unit-test the handler logic by calling tool handler functions directly with a mocked in-memory DB (same pattern as `routes-agents.test.ts`). Do NOT test MCP protocol-level behavior -- the SDK handles that. Focus on: correct DB operations, enriched response shapes, error guidance messages, confirmation flow for destructive operations.

## Sources

### Primary (HIGH confidence)
- [@modelcontextprotocol/sdk v1.27.1 npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) -- version, peer deps, exports
- [MCP TypeScript SDK server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) -- McpServer API, registerTool, StdioServerTransport, code examples
- [MCP Build Server tutorial](https://modelcontextprotocol.io/docs/develop/build-server) -- complete TypeScript MCP server example with tools
- [MCP SDK releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) -- v1.25.0 Zod v4 support, v1.27.1 latest

### Secondary (MEDIUM confidence)
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) -- .mcp.json configuration, scopes
- [MCP SDK Zod v4 issue #925](https://github.com/modelcontextprotocol/typescript-sdk/issues/925) -- confirmed fixed in v1.23.0+
- [MCP SDK descriptions issue #1143](https://github.com/modelcontextprotocol/typescript-sdk/issues/1143) -- fixed in v1.25.0 with Zod 4.1.13+
- [MCP error handling guide](https://mcpcat.io/guides/error-handling-custom-mcp-servers/) -- isError pattern, error message quality

### Tertiary (LOW confidence)
- None -- all findings verified with official sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- official SDK v1.27.1 is well-documented, stable, Zod v4 compatible
- Architecture: HIGH -- patterns drawn from official docs and project's established conventions
- Pitfalls: HIGH -- stdio logging, env validation, and DB path issues verified from official docs and issue trackers

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable SDK, unlikely to change significantly)
