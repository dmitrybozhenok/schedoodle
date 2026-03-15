# Phase 9: Agent Tool Use with Built-in and Custom Tools - Research

**Researched:** 2026-03-15
**Domain:** Vercel AI SDK tool calling, Brave Search API, Drizzle ORM many-to-many, webhook tools
**Confidence:** HIGH

## Summary

This phase adds LLM-driven tool use to agents via the Vercel AI SDK's built-in `tool()` and multi-step `generateText` loop. The project already runs AI SDK 6.0.116 and `@ai-sdk/anthropic` 3.0.58, both fully supporting tool calling with structured output. The SDK handles the tool execution loop automatically: call LLM, execute requested tools, feed results back, repeat until done or the step limit is reached. Two built-in tools ship (web_fetch, web_search) plus a user-defined webhook tool system with full CRUD and many-to-many agent-tool linking.

The key SDK migration note: AI SDK 6 replaced `maxSteps` with `stopWhen: stepCountIs(N)` (default is `stepCountIs(20)`). Since CONTEXT.md specifies `maxSteps: 10`, use `stopWhen: stepCountIs(10)`. When combining tools with `Output.object()` for structured output, the final structured output generation counts as one step, so ensure the step budget accounts for this (10 steps total including the final output step = 9 tool steps + 1 output step, which is sufficient).

**Primary recommendation:** Use `generateText` with `tools`, `output: Output.object({ schema })`, and `stopWhen: stepCountIs(10)`. Define built-in tools as `tool()` instances with Zod input schemas and `execute` functions. Store custom webhook tools in a `tools` table with JSON Schema input definitions. Use AbortController for per-agent execution timeout.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Two built-in tools ship by default: `web_fetch` (fetch a URL, return content) and `web_search` (Brave Search API, return structured results)
- Built-in tools are automatically available to all agents -- no per-agent opt-in needed
- Custom tools are HTTP webhook tools: user defines URL, method, headers, and JSON Schema for input
- Pre-fetch pattern (Phase 2) stays for URLs in task descriptions; tool use extends it for URLs the LLM discovers during reasoning
- Both built-in and custom webhook tools in this phase
- Separate `tools` table in the database with its own schema (id, name, description, url, method, headers, inputSchema)
- Many-to-many join table links tools to agents (tools are reusable across agents)
- Full CRUD API at `/tools` (POST, GET, PATCH, DELETE)
- Attach tools to agents via POST /agents/:id/tools/:toolId (or similar)
- Tool input schema defined as standard JSON Schema object (works directly with Vercel AI SDK tool() function)
- Use Vercel AI SDK `generateText` with built-in `maxSteps` parameter (set to 10) -- NOTE: In AI SDK 6, use `stopWhen: stepCountIs(10)` instead
- SDK handles the tool call loop automatically
- Circuit breaker wraps the entire `generateText` call
- Tool call details are logged: store array of {toolName, input, output, durationMs} in execution history
- Configurable per-agent execution timeout (default 60s), separate from per-URL 10s fetch timeout
- New `maxExecutionMs` column on agents table (nullable, default 60000)
- No per-step limit on parallel tool calls -- maxSteps (10) caps total iterations
- Webhook tools support static headers for auth (Bearer tokens, API keys stored in tools table)
- Brave Search API key via environment variable (BRAVE_API_KEY)

### Claude's Discretion
- Exact join table design for agent-tool relationships
- How tool call logs are stored (JSON column vs separate table)
- Brave Search API response parsing/formatting
- How `stopWhen` interacts with the existing validation retry logic
- AbortController implementation for per-agent timeout budget
- web_fetch tool implementation detail (reuse prefetch.ts logic vs new implementation)

### Deferred Ideas (OUT OF SCOPE)
- Shell command / code execution tool
- Per-agent tool opt-out for built-ins
- Tool authentication beyond static headers (OAuth, dynamic tokens)
- Per-agent maxSteps override -- fixed at 10 for now
- Tool marketplace / sharing
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai | 6.0.116 | `generateText` with `tool()`, `stopWhen`, `Output.object` | Already installed; native tool calling loop |
| @ai-sdk/anthropic | 3.0.58 | Claude model provider with tool calling support | Already installed; Claude supports tools natively |
| zod | 4.3.6 | Tool input schemas, validation | Already installed; project convention |
| drizzle-orm | 0.45.1 | New tools table, join table, maxExecutionMs column | Already installed; project ORM |
| hono | 4.12.8 | New /tools routes, agent-tool attachment endpoints | Already installed; project framework |
| html-to-text | 9.0.5 | HTML-to-plaintext in web_fetch tool (reuse from prefetch.ts) | Already installed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @hono/zod-validator | 0.7.6 | Request validation for /tools CRUD endpoints | Already installed; use for all route validation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom Brave API fetch | brave-search npm package | Adds dependency for a single HTTP call; just use fetch() |
| Separate tool_call_logs table | JSON column on execution_history | JSON column is simpler, sufficient for debugging; no querying needed |

**Installation:**
```bash
# No new dependencies needed -- all libraries already installed
# Only add BRAVE_API_KEY to .env
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  services/
    tools/
      web-fetch.ts       # Built-in web_fetch tool definition
      web-search.ts      # Built-in web_search tool definition
      webhook.ts         # Custom webhook tool executor factory
      registry.ts        # Combines built-in + agent's custom tools into ToolSet
  routes/
    tools.ts             # CRUD for custom tool definitions
  schemas/
    tool-input.ts        # Zod schemas for tool CRUD validation
  db/
    schema.ts            # Add tools table, agentTools join table, maxExecutionMs on agents
```

### Pattern 1: Tool Definition with AI SDK tool()
**What:** Each built-in tool is a `tool()` instance with Zod inputSchema and async execute function.
**When to use:** For web_fetch and web_search built-in tools.
**Example:**
```typescript
// Source: https://ai-sdk.dev/docs/foundations/tools
import { tool } from "ai";
import { z } from "zod";

export const webFetchTool = tool({
  description: "Fetch the content of a URL and return it as plain text. Use this when you need to read a web page or API endpoint.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch"),
  }),
  execute: async ({ url }, { abortSignal }) => {
    const response = await fetch(url, {
      signal: abortSignal,
      headers: { "User-Agent": "Schedoodle/1.0" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    if (contentType.includes("text/html")) {
      return convert(body, { wordwrap: 120 });
    }
    return body;
  },
});
```

### Pattern 2: Dynamic Webhook Tool Factory
**What:** Convert a custom tool DB record into an AI SDK `tool()` at execution time.
**When to use:** For user-defined webhook tools loaded from the database.
**Example:**
```typescript
// Factory that creates an AI SDK tool from a DB tool record
import { tool } from "ai";
import { jsonSchema } from "ai";

export function createWebhookTool(toolDef: ToolRecord) {
  return tool({
    description: toolDef.description,
    inputSchema: jsonSchema(toolDef.inputSchema), // JSON Schema from DB
    execute: async (input, { abortSignal }) => {
      const response = await fetch(toolDef.url, {
        method: toolDef.method,
        headers: {
          "Content-Type": "application/json",
          ...JSON.parse(toolDef.headers ?? "{}"),
        },
        body: JSON.stringify(input),
        signal: abortSignal,
      });
      return response.text();
    },
  });
}
```

### Pattern 3: Multi-Step generateText with Tools + Structured Output
**What:** Use `generateText` with tools, `Output.object()`, and `stopWhen: stepCountIs(10)` for the agent execution loop.
**When to use:** In the modified executor.ts `callLlmWithRetry`.
**Example:**
```typescript
// Source: https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text
import { generateText, Output, stepCountIs } from "ai";

const result = await generateText({
  model,
  system: systemPrompt ?? undefined,
  output: Output.object({ schema: agentOutputSchema }),
  tools: toolSet,        // combined built-in + custom tools
  stopWhen: stepCountIs(10),
  abortSignal,           // from AbortController with per-agent timeout
  prompt: userMessage,
  onStepFinish({ stepNumber, toolCalls, toolResults, usage }) {
    // Log tool calls for observability
    for (const tc of toolCalls) {
      toolCallLog.push({
        toolName: tc.toolName,
        input: tc.args,
        durationMs: 0, // computed from step timing
      });
    }
  },
});
```

### Pattern 4: AbortController for Per-Agent Timeout
**What:** Create an AbortController with timeout to enforce per-agent execution budget.
**When to use:** Wrapping each `generateText` call in executeAgent.
**Example:**
```typescript
const timeoutMs = agent.maxExecutionMs ?? 60_000;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const result = await generateText({
    // ...
    abortSignal: controller.signal,
  });
} finally {
  clearTimeout(timeout);
}
```

### Pattern 5: Tool Call Logging via JSON Column
**What:** Store tool call details as a JSON array in the existing `execution_history` table.
**When to use:** For observability of what tools an agent used during execution.
**Recommendation:** Add a `toolCalls` JSON column to `execution_history` rather than a separate table. The data is write-once, read-for-debugging, and always accessed alongside the execution record.
```typescript
// Schema addition
toolCalls: text("tool_calls", { mode: "json" }),

// Data shape
type ToolCallLog = {
  toolName: string;
  input: unknown;
  output: string;  // truncated to reasonable length
  durationMs: number;
}[];
```

### Pattern 6: Join Table Design for Agent-Tool Relationships
**What:** Simple junction table with composite primary key.
**Recommendation:**
```typescript
export const agentTools = sqliteTable(
  "agent_tools",
  {
    agentId: integer("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    toolId: integer("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    // Composite unique constraint prevents duplicate assignments
    uniqueIndex("agent_tools_unique").on(table.agentId, table.toolId),
  ],
);
```
Use `onDelete: "cascade"` so deleting a tool or agent cleans up the join table automatically.

### Anti-Patterns to Avoid
- **Separate generateText calls for tools vs structured output:** Use a single `generateText` call with both `tools` and `output: Output.object()`. The SDK handles the loop.
- **Storing full tool outputs in logs:** Truncate large outputs (HTML pages, API responses) before storing in the tool call log. A 2000-char limit per output is reasonable.
- **Wrapping each tool step in circuit breaker:** The circuit breaker wraps the entire `generateText` call, not individual steps. Tool execution failures within steps are handled by the SDK.
- **Parsing JSON Schema at request time:** Store inputSchema as a JSON object in the DB (text column with mode: "json"). The AI SDK's `jsonSchema()` helper converts it at tool creation time.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool call loop | Custom while loop checking tool calls | AI SDK `generateText` with `stopWhen` | SDK handles call/result/re-prompt cycle, error propagation, step tracking |
| JSON Schema to tool input | Custom schema parser | AI SDK `jsonSchema()` helper | Handles conversion from raw JSON Schema to AI SDK's expected format |
| Execution timeout | Manual Promise.race | `AbortController` + `abortSignal` param | SDK propagates signal to tool execute functions; clean cancellation |
| Tool input validation | Custom validation against JSON Schema | AI SDK validates automatically | SDK validates tool call inputs against schema before calling execute |
| Step counting | Manual counter in a loop | `stepCountIs()` from AI SDK | Purpose-built stopping condition |
| Brave Search response parsing | Custom HTML parser | Just use the JSON API | Brave returns structured JSON; parse the `web.results` array |

**Key insight:** The AI SDK 6 tool calling system handles the entire multi-step execution loop. The project only needs to define tools (input schema + execute function) and pass them to `generateText`. The SDK manages invocation, result feeding, step counting, and abort signal propagation.

## Common Pitfalls

### Pitfall 1: maxSteps vs stopWhen (AI SDK 6 Breaking Change)
**What goes wrong:** Using `maxSteps` which was replaced by `stopWhen` in AI SDK 6.
**Why it happens:** CONTEXT.md references "maxSteps" from pre-SDK-6 documentation.
**How to avoid:** Use `stopWhen: stepCountIs(10)` instead of `maxSteps: 10`. Import `stepCountIs` from `"ai"`.
**Warning signs:** TypeScript error on `maxSteps` property, or default 20-step behavior if neither is set.

### Pitfall 2: Structured Output Counts as a Step
**What goes wrong:** Agent runs out of steps before producing the final structured output.
**Why it happens:** When using `Output.object()` with tools, generating the structured output consumes one step from the budget.
**How to avoid:** With `stepCountIs(10)`, the agent gets up to 9 tool-calling rounds + 1 final output round. This is sufficient for the stated design. Document this tradeoff.
**Warning signs:** `finishReason` of `"length"` or missing `output` in the result.

### Pitfall 3: Tool Execute Errors Kill the Whole Call
**What goes wrong:** An unhandled error in a tool's `execute` function causes `generateText` to throw.
**Why it happens:** Tool execute functions that throw propagate up through the SDK.
**How to avoid:** Wrap each tool's execute in try/catch. Return error messages as string results so the LLM can adapt. The web_fetch tool should return `"[Failed to fetch: <error>]"` like the existing prefetch pattern.
**Warning signs:** Agent executions failing with fetch/network errors instead of graceful degradation.

### Pitfall 4: No Timeout on Individual Tool Fetches
**What goes wrong:** A single webhook call hangs for the entire execution budget.
**Why it happens:** The AbortController covers the overall budget, but individual fetch calls within tools need their own timeout.
**How to avoid:** Use `AbortSignal.timeout(10_000)` for individual HTTP calls within tool execute functions (matching the existing 10s prefetch timeout). Combine with the parent abort signal using `AbortSignal.any([signal, AbortSignal.timeout(10_000)])`.
**Warning signs:** Agents timing out with a single tool call consuming all 60 seconds.

### Pitfall 5: Headers Stored as Plain Text
**What goes wrong:** API keys and auth tokens in tool headers are stored in the database unencrypted.
**Why it happens:** The tools table stores headers as JSON text.
**How to avoid:** This is acceptable for a personal tool (stated in project scope: no multi-user, runs on localhost/VPN). Document the limitation. Don't log headers in tool call logs.
**Warning signs:** N/A for personal use; would need encryption for multi-user.

### Pitfall 6: Validation Retry Logic Interaction with Multi-Step
**What goes wrong:** The existing `callLlmWithRetry` catches `NoObjectGeneratedError` and retries once. With multi-step tool calling, this error might occur at the final output step.
**Why it happens:** AI SDK 6's `Output.object()` with tools means structured output is the last step. If the LLM fails to produce valid structured output, `NoObjectGeneratedError` is thrown.
**How to avoid:** Keep the retry logic but understand it now retries the *entire* multi-step call (all tool steps re-execute). This is fine because: (a) it only happens on schema validation failure, (b) one retry is bounded, (c) the circuit breaker still protects against cascading failures.
**Warning signs:** Doubled token usage on validation retries with tools.

### Pitfall 7: jsonSchema() for Custom Tool Input Schemas
**What goes wrong:** Passing raw JSON Schema objects directly as `inputSchema` to `tool()`.
**Why it happens:** `tool()` expects a Zod schema or an AI SDK schema wrapper.
**How to avoid:** Use `import { jsonSchema } from "ai"` to wrap the raw JSON Schema object from the database. The `jsonSchema()` helper creates the right wrapper.
**Warning signs:** TypeScript type errors on `inputSchema`, or runtime schema validation failures.

## Code Examples

### web_fetch Tool Implementation (Reusing prefetch.ts Logic)
```typescript
// Source: existing src/services/prefetch.ts patterns + AI SDK tool docs
import { tool } from "ai";
import { z } from "zod";
import { convert } from "html-to-text";

export const webFetchTool = tool({
  description:
    "Fetch content from a URL. Returns plain text for HTML pages, raw text for JSON/other. Use when you need to read a webpage, API, or data source not already provided in the context.",
  inputSchema: z.object({
    url: z.string().url().describe("The HTTP or HTTPS URL to fetch"),
  }),
  execute: async ({ url }, { abortSignal }) => {
    try {
      // Combine parent abort signal with per-fetch 10s timeout
      const combinedSignal = AbortSignal.any([
        abortSignal,
        AbortSignal.timeout(10_000),
      ]);
      const response = await fetch(url, {
        signal: combinedSignal,
        headers: { "User-Agent": "Schedoodle/1.0" },
      });
      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      if (contentType.includes("text/html")) {
        return convert(body, { wordwrap: 120 });
      }
      return body;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[Failed to fetch ${url} -- ${msg}]`;
    }
  },
});
```

### web_search Tool Implementation (Brave Search API)
```typescript
// Source: https://api.search.brave.com/app/documentation/web-search
import { tool } from "ai";
import { z } from "zod";
import { env } from "../../config/env.js";

export const webSearchTool = tool({
  description:
    "Search the web using Brave Search. Returns titles, URLs, and descriptions of matching pages. Use when you need to find current information, news, or discover URLs to fetch.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    count: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .optional()
      .describe("Number of results to return (1-10, default 5)"),
  }),
  execute: async ({ query, count = 5 }, { abortSignal }) => {
    const apiKey = env.BRAVE_API_KEY;
    if (!apiKey) {
      return "[Web search unavailable: BRAVE_API_KEY not configured]";
    }
    try {
      const params = new URLSearchParams({ q: query, count: String(count) });
      const combinedSignal = AbortSignal.any([
        abortSignal,
        AbortSignal.timeout(10_000),
      ]);
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?${params}`,
        {
          signal: combinedSignal,
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": apiKey,
          },
        },
      );
      if (!response.ok) {
        return `[Search failed: HTTP ${response.status}]`;
      }
      const data = await response.json();
      const results = data.web?.results ?? [];
      return results
        .map(
          (r: { title: string; url: string; description: string }) =>
            `${r.title}\n${r.url}\n${r.description}`,
        )
        .join("\n\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[Search failed: ${msg}]`;
    }
  },
});
```

### Modified callLlmWithRetry with Tools
```typescript
// Source: AI SDK 6 docs + existing executor.ts pattern
import { generateText, Output, stepCountIs, NoObjectGeneratedError } from "ai";

async function callLlmWithRetry(
  modelId: string,
  systemPrompt: string | null,
  userMessage: string,
  toolSet: Record<string, ReturnType<typeof tool>>,
  abortSignal: AbortSignal,
) {
  const model = await resolveModel(modelId);
  const baseOptions = {
    model,
    system: systemPrompt ?? undefined,
    output: Output.object({ schema: agentOutputSchema }),
    tools: toolSet,
    stopWhen: stepCountIs(10),
    abortSignal,
  };

  try {
    const result = await generateText({ ...baseOptions, prompt: userMessage });
    return { result, retryCount: 0 };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const retryPrompt = `${userMessage}\n\n[Previous attempt failed validation: ${errorMsg}]\nPlease provide a valid response matching the required schema.`;
      const result = await generateText({ ...baseOptions, prompt: retryPrompt });
      return { result, retryCount: 1 };
    }
    throw error;
  }
}
```

### Tools Table Schema
```typescript
// Addition to src/db/schema.ts
export const tools = sqliteTable("tools", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  url: text("url").notNull(),
  method: text("method", { enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] })
    .notNull()
    .default("POST"),
  headers: text("headers", { mode: "json" }),  // { "Authorization": "Bearer xxx" }
  inputSchema: text("input_schema", { mode: "json" }).notNull(), // JSON Schema object
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const agentTools = sqliteTable(
  "agent_tools",
  {
    agentId: integer("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    toolId: integer("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("agent_tools_unique").on(table.agentId, table.toolId),
  ],
);
```

### BRAVE_API_KEY in env.ts
```typescript
// Addition to envSchema in src/config/env.ts
BRAVE_API_KEY: z.string().optional(),
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `maxSteps: N` | `stopWhen: stepCountIs(N)` | AI SDK 6.0 (Dec 2025) | Must use new API; codemod available |
| `generateObject()` | `generateText({ output: Output.object() })` | AI SDK 6.0 (Dec 2025) | Allows combining structured output + tools in one call |
| Separate tool loop | Built-in multi-step in `generateText` | AI SDK 5.0+ | No need for manual while loop |
| `ToolCallOptions` type | `ToolExecutionOptions` type | AI SDK 6.0 | Type rename in execute function second param |

**Deprecated/outdated:**
- `generateObject()`: Deprecated in AI SDK 6; replaced by `generateText` with `Output.object()`
- `maxSteps`: Replaced by `stopWhen: stepCountIs(N)` in AI SDK 6
- `convertToCoreMessages`: Renamed to `convertToModelMessages` (not used in this project)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TOOL-01 | web_fetch tool fetches URL and returns content | unit | `pnpm vitest run tests/tools-web-fetch.test.ts -t "fetches"` | No - Wave 0 |
| TOOL-02 | web_search tool queries Brave API and returns results | unit | `pnpm vitest run tests/tools-web-search.test.ts -t "search"` | No - Wave 0 |
| TOOL-03 | Custom webhook tool executes HTTP call | unit | `pnpm vitest run tests/tools-webhook.test.ts -t "webhook"` | No - Wave 0 |
| TOOL-04 | Tools CRUD API (create, read, update, delete) | unit | `pnpm vitest run tests/routes-tools.test.ts` | No - Wave 0 |
| TOOL-05 | Agent-tool attachment (link/unlink) | unit | `pnpm vitest run tests/routes-agents.test.ts -t "tools"` | No - Wave 0 |
| TOOL-06 | generateText uses tools + structured output | unit | `pnpm vitest run tests/executor.test.ts -t "tools"` | No - Wave 0 |
| TOOL-07 | Tool call logs stored in execution history | unit | `pnpm vitest run tests/executor.test.ts -t "tool call"` | No - Wave 0 |
| TOOL-08 | Per-agent execution timeout via AbortController | unit | `pnpm vitest run tests/executor.test.ts -t "timeout"` | No - Wave 0 |
| TOOL-09 | DB schema: tools table, agent_tools join, maxExecutionMs | unit | `pnpm vitest run tests/db.test.ts -t "tools"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/tools-web-fetch.test.ts` -- unit tests for web_fetch tool
- [ ] `tests/tools-web-search.test.ts` -- unit tests for web_search tool (mock Brave API)
- [ ] `tests/tools-webhook.test.ts` -- unit tests for webhook tool factory
- [ ] `tests/routes-tools.test.ts` -- CRUD route tests for /tools endpoints
- [ ] Update `tests/executor.test.ts` -- add tests for tool-enabled execution, tool call logging, timeout
- [ ] Update `tests/db.test.ts` -- add tests for tools table, agent_tools join table, maxExecutionMs column

## Open Questions

1. **AbortSignal.any() availability**
   - What we know: `AbortSignal.any()` is available in Node.js 20+. The project targets modern Node.
   - What's unclear: Exact Node.js version requirement for the project.
   - Recommendation: Use `AbortSignal.any()` for combining parent + per-fetch timeouts. If Node < 20, use `AbortSignal.timeout()` alone for per-fetch calls and let the parent signal handle overall timeout via the SDK's `abortSignal` parameter.

2. **jsonSchema() import from AI SDK**
   - What we know: The AI SDK exports a `jsonSchema()` helper for converting raw JSON Schema objects to the format expected by `tool()`.
   - What's unclear: Exact import path and whether it handles all JSON Schema features the user might define.
   - Recommendation: Verify `jsonSchema` is exported from `"ai"` at implementation time. Limit supported JSON Schema to basic object types with string/number/boolean/array properties.

3. **totalUsage across multi-step calls**
   - What we know: AI SDK 6 provides `totalUsage` aggregating token counts across all steps. The existing cost calculation uses `result.usage`.
   - What's unclear: Whether `totalUsage` replaces `usage` or supplements it.
   - Recommendation: Use `result.totalUsage` for cost tracking when tools are involved (aggregates all LLM calls across steps). Fall back to `result.usage` if `totalUsage` is undefined.

## Sources

### Primary (HIGH confidence)
- [AI SDK generateText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) -- tools, stopWhen, Output.object, abortSignal, onStepFinish
- [AI SDK tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) -- tool() function, multi-step, execute context, error handling
- [AI SDK foundations: tools](https://ai-sdk.dev/docs/foundations/tools) -- tool definition patterns, Zod schemas, execute functions
- [AI SDK 6 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0) -- maxSteps to stopWhen, generateObject deprecation
- [AI SDK troubleshooting: tool calling with structured outputs](https://ai-sdk.dev/docs/troubleshooting/tool-calling-with-structured-outputs) -- step counting with Output.object
- Project source code (executor.ts, prefetch.ts, schema.ts, env.ts, agents.ts) -- existing patterns

### Secondary (MEDIUM confidence)
- [AI SDK 6 blog post](https://vercel.com/blog/ai-sdk-6) -- feature overview, stopWhen default of 20 steps
- [Brave Search API documentation](https://api-dashboard.search.brave.com/app/documentation/web-search) -- endpoint, query params, response format
- [Drizzle ORM relations documentation](https://orm.drizzle.team/docs/relations-schema-declaration) -- many-to-many join table patterns

### Tertiary (LOW confidence)
- AbortSignal.any() Node.js version requirement -- needs runtime verification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and verified in project
- Architecture: HIGH -- AI SDK 6 tool calling patterns well-documented, project patterns well-established
- Pitfalls: HIGH -- confirmed maxSteps deprecation, step counting with structured output, verified in official docs
- Brave Search API: MEDIUM -- response format confirmed via docs but not tested
- joinSchema/jsonSchema: MEDIUM -- `jsonSchema()` helper confirmed exported but import path needs verification

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable libraries, no upcoming breaking changes expected)
