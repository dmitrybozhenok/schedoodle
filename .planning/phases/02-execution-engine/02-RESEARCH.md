# Phase 2: Execution Engine - Research

**Researched:** 2026-03-14
**Domain:** LLM execution pipeline (Vercel AI SDK + Anthropic + Zod structured output)
**Confidence:** HIGH

## Summary

Phase 2 builds the core execution function: `executeAgent(agent, db)` in `src/services/executor.ts`. It sends an agent's task to Claude via the Vercel AI SDK, validates the response against a shared Zod schema, optionally pre-fetches URLs from the task description, and records results in `execution_history`.

The critical discovery is that **AI SDK 6 deprecates `generateObject`** in favor of `generateText` with `Output.object()`. Since the project has no existing AI SDK dependency, we install AI SDK 6 directly and use the current API. The project's Zod v4.3.6 is fully compatible with AI SDK 6 (Zod v4 support was fixed in Zod 4.0.4).

**Primary recommendation:** Use `generateText` + `Output.object()` from `ai@^6.0.0` with `@ai-sdk/anthropic@^3.0.0`. Use the `html-to-text` package for HTML stripping. Keep the executor as a pure async function with no class or state.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use Vercel AI SDK with generateObject() for structured output in one call
  - **NOTE:** `generateObject` is deprecated in AI SDK 6. The equivalent is `generateText` + `Output.object()`. Same outcome (structured output in one call), updated API surface.
- Agent's systemPrompt field maps to LLM system message; task description maps to user message
- Execution service is a plain function: `executeAgent(agent, db)` in `src/services/executor.ts` -- stateless, easy to test
- Model is configurable per-agent via a 'model' column on agents table (default: claude-sonnet-4-20250514)
- URLs extracted inline from agent's task description (no separate DB column)
- 10-second timeout per URL fetch
- On fetch failure: skip URL, include note in LLM context
- Strip HTML from web pages, pass as plain text; pass JSON API responses as raw JSON
- Single shared Zod schema for all agents in v1: `{ summary: string, details: string, data?: unknown }`
- On Zod validation failure: retry LLM call once with validation error as feedback; if second attempt fails, mark as 'failure'
- Store validated result as JSON in execution_history.result column
- Status transitions: insert 'running' record before LLM call, update to 'success' or 'failure'
- Multiple agents run concurrently via Promise.allSettled
- Measure wall-clock execution time in milliseconds, store in duration_ms
- Extract token counts from AI SDK response and store in existing columns

### Claude's Discretion
- URL extraction implementation (regex vs URL parsing)
- HTML-to-text library choice
- Exact error message formatting in the error column
- How pre-fetched data is formatted in the LLM context prompt

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXEC-01 | Agent executes its task by sending the task description to an LLM and receiving a structured response | `generateText` + `Output.object()` with Anthropic provider; system/prompt mapping documented |
| EXEC-02 | LLM responses are validated against Zod schemas and returned as typed, structured output | `Output.object({ schema })` handles validation; `NoObjectGeneratedError` for failures; retry pattern documented |
| EXEC-03 | A single agent failure never crashes the service or blocks other agents | `Promise.allSettled` pattern; try/catch in executor; status column transitions documented |
| EXEC-04 | Agents can fetch data from external URLs before the LLM call, passing fetched data as context | URL extraction, fetch with timeout, HTML-to-text conversion, context formatting all documented |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai | ^6.0.0 | Core AI SDK (generateText, Output) | Official Vercel AI SDK; generateObject deprecated in v6 |
| @ai-sdk/anthropic | ^3.0.0 | Anthropic provider for AI SDK | Official provider; reads ANTHROPIC_API_KEY from env by default |
| zod | ^4.3.6 | Schema validation (already installed) | Already in project; compatible with AI SDK 6 since Zod 4.0.4 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| html-to-text | ^9.0.0 | Convert HTML to plain text | When pre-fetched URL returns HTML content |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| html-to-text | cheerio + manual extraction | html-to-text is purpose-built, handles edge cases (tables, lists, encoding) |
| html-to-text | regex stripping | Breaks on nested tags, entities, script/style content |
| URL regex extraction | URL class parsing | Regex is simpler for finding URLs in prose text; URL class is for validating known URLs |

**Installation:**
```bash
pnpm add ai @ai-sdk/anthropic html-to-text
pnpm add -D @types/html-to-text
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  services/
    executor.ts          # executeAgent() function + helpers
  schemas/
    agent-output.ts      # Shared Zod output schema for v1
  db/
    schema.ts            # Add 'model' column to agents table
```

### Pattern 1: Stateless Executor Function
**What:** `executeAgent(agent, db)` is a pure async function that takes an Agent row and a Database handle, returns a structured result.
**When to use:** Always -- this is the locked design decision.
**Example:**
```typescript
// src/services/executor.ts
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { eq } from "drizzle-orm";
import { agentOutputSchema } from "../schemas/agent-output.js";
import { executionHistory } from "../db/schema.js";
import type { Agent } from "../types/index.js";
import type { Database } from "../db/index.js";

export async function executeAgent(agent: Agent, db: Database) {
  const startTime = Date.now();

  // 1. Insert 'running' record
  const [execution] = db
    .insert(executionHistory)
    .values({ agentId: agent.id, status: "running" })
    .returning();

  try {
    // 2. Pre-fetch URLs from task description
    const contextData = await prefetchUrls(agent.taskDescription);

    // 3. Build prompt with pre-fetched data
    const userMessage = buildPrompt(agent.taskDescription, contextData);

    // 4. Call LLM with structured output
    const result = await generateText({
      model: anthropic(agent.model ?? "claude-sonnet-4-20250514"),
      system: agent.systemPrompt ?? undefined,
      output: Output.object({ schema: agentOutputSchema }),
      prompt: userMessage,
    });

    const durationMs = Date.now() - startTime;

    // 5. Update execution record with success
    db.update(executionHistory)
      .set({
        status: "success",
        result: result.output,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        durationMs,
        completedAt: new Date().toISOString(),
      })
      .where(eq(executionHistory.id, execution.id))
      .run();

    return { status: "success" as const, executionId: execution.id, output: result.output };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    db.update(executionHistory)
      .set({
        status: "failure",
        error: errorMessage,
        durationMs,
        completedAt: new Date().toISOString(),
      })
      .where(eq(executionHistory.id, execution.id))
      .run();

    return { status: "failure" as const, executionId: execution.id, error: errorMessage };
  }
}
```

### Pattern 2: URL Pre-Fetch with Graceful Degradation
**What:** Extract URLs from task description, fetch each with a timeout, convert HTML to text, and include in prompt. Failed fetches produce a note, not an error.
**When to use:** EXEC-04 requirement.
**Example:**
```typescript
import { convert } from "html-to-text";

const URL_REGEX = /https?:\/\/[^\s)>\]]+/g;

async function prefetchUrls(taskDescription: string): Promise<Map<string, string>> {
  const urls = [...new Set(taskDescription.match(URL_REGEX) ?? [])];
  const results = new Map<string, string>();

  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
        });
        const contentType = response.headers.get("content-type") ?? "";
        const body = await response.text();

        if (contentType.includes("application/json")) {
          results.set(url, body); // raw JSON
        } else if (contentType.includes("text/html")) {
          results.set(url, convert(body, { wordwrap: 120 }));
        } else {
          results.set(url, body); // plain text fallback
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "unknown error";
        results.set(url, `[Failed to fetch ${url} -- ${reason}]`);
      }
    })
  );

  return results;
}
```

### Pattern 3: Retry on Validation Failure
**What:** Catch `NoObjectGeneratedError`, retry once with the validation error as feedback.
**When to use:** Locked decision -- retry LLM call once on Zod validation failure.
**Example:**
```typescript
import { generateText, Output, NoObjectGeneratedError } from "ai";

async function callLlmWithRetry(
  model: string,
  systemPrompt: string | undefined,
  userMessage: string,
  schema: typeof agentOutputSchema,
) {
  try {
    return await generateText({
      model: anthropic(model),
      system: systemPrompt,
      output: Output.object({ schema }),
      prompt: userMessage,
    });
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      // Retry with validation error as feedback
      return await generateText({
        model: anthropic(model),
        system: systemPrompt,
        output: Output.object({ schema }),
        prompt: `${userMessage}\n\nPrevious attempt failed validation: ${error.cause}\nPlease format your response to match the required schema exactly.`,
      });
    }
    throw error; // Non-validation errors propagate
  }
}
```

### Pattern 4: Concurrent Execution with Promise.allSettled
**What:** Run multiple agents concurrently; each resolves independently.
**When to use:** When Phase 3 scheduler triggers multiple agents at the same cron tick.
**Example:**
```typescript
export async function executeAgents(agents: Agent[], db: Database) {
  const results = await Promise.allSettled(
    agents.map((agent) => executeAgent(agent, db))
  );
  return results; // Each is { status: 'fulfilled', value } or { status: 'rejected', reason }
}
```

### Anti-Patterns to Avoid
- **Wrapping executor in a class with state:** The executor must be a pure function. No singleton, no internal caches, no retry state beyond the single validation retry.
- **Throwing on fetch failure:** Pre-fetch errors must be caught and converted to notes in the prompt, never propagated.
- **Using `generateObject` directly:** Deprecated in AI SDK 6. Use `generateText` + `Output.object()`.
- **Hardcoding model name:** The agent has a `model` column; always read from it with a fallback default.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured LLM output | Custom JSON parsing + prompt engineering | `Output.object({ schema })` | Handles JSON mode, retries, schema enforcement across providers |
| HTML to plain text | Regex strip tags | `html-to-text` package | Handles entities, nested tags, tables, lists, script/style removal |
| Fetch timeout | setTimeout + AbortController wiring | `AbortSignal.timeout(10_000)` | Built into Node.js 18+; single line, no cleanup needed |
| Schema validation | Manual JSON.parse + type checks | Zod schema `.parse()` / AI SDK Output | Type inference, error messages, composability |
| Concurrent execution | Manual Promise tracking | `Promise.allSettled()` | Never rejects; gives per-promise status |

**Key insight:** The AI SDK abstracts away the complexity of structured output generation (JSON mode negotiation, schema conversion, response parsing). Using it means we never hand-roll JSON extraction from LLM text.

## Common Pitfalls

### Pitfall 1: generateObject is Deprecated
**What goes wrong:** Using `generateObject` from AI SDK 6 triggers deprecation warnings and will break in a future release.
**Why it happens:** AI SDK 6 unified object generation into `generateText` with `Output.object()`.
**How to avoid:** Import `generateText` and `Output` from `"ai"`, not `generateObject`.
**Warning signs:** Deprecation warnings in console output.

### Pitfall 2: Token Usage Property Names
**What goes wrong:** Accessing `usage.promptTokens` or `usage.completionTokens` (OpenAI naming) when the AI SDK uses `usage.inputTokens` and `usage.outputTokens`.
**Why it happens:** Different providers use different names; the AI SDK normalizes to `inputTokens`/`outputTokens`.
**How to avoid:** Use `result.usage.inputTokens` and `result.usage.outputTokens`. These may be undefined; handle with `?? null`.
**Warning signs:** Token columns are always null in execution_history.

### Pitfall 3: Anthropic API Key Environment Variable
**What goes wrong:** Passing the API key manually when the SDK reads it automatically.
**Why it happens:** Over-configuration. `@ai-sdk/anthropic` reads `ANTHROPIC_API_KEY` from `process.env` by default.
**How to avoid:** Just `import { anthropic } from "@ai-sdk/anthropic"` and use it. The env.ts already validates the key exists.
**Warning signs:** Duplicate key configuration, env var not found errors in custom code.

### Pitfall 4: Zod v4 Import Path
**What goes wrong:** Using `import { z } from "zod/v4"` instead of `import { z } from "zod"`.
**Why it happens:** Some migration guides mention `zod/v4` as a Zod 3 compatibility shim. Project already uses Zod v4 natively.
**How to avoid:** Always `import { z } from "zod"` -- the project's Zod 4.3.6 exports v4 API at the top level.
**Warning signs:** Type errors, missing exports.

### Pitfall 5: Forgetting `.run()` on Drizzle Sync Operations
**What goes wrong:** Drizzle `update().set().where()` returns a query builder, not the result. Without `.run()` (for better-sqlite3), the update never executes.
**Why it happens:** Drizzle's API is lazy by default.
**How to avoid:** Always chain `.run()` for fire-and-forget updates, `.all()` or `.get()` for reads.
**Warning signs:** Execution records stay in 'running' status forever.

### Pitfall 6: AbortSignal.timeout Not Available
**What goes wrong:** `AbortSignal.timeout()` is not available in Node.js < 17.3.
**Why it happens:** Project targets ES2022, but runtime might be older.
**How to avoid:** Verify Node.js >= 18 in package.json engines field. The project uses Node 25+ features already (Zod v4, ESM), so this is likely fine.
**Warning signs:** `AbortSignal.timeout is not a function` runtime error.

## Code Examples

### Shared Output Schema
```typescript
// src/schemas/agent-output.ts
import { z } from "zod";

export const agentOutputSchema = z.object({
  summary: z.string().describe("A concise summary of the task result"),
  details: z.string().describe("Detailed findings or output"),
  data: z.unknown().optional().describe("Optional structured data relevant to the task"),
});

export type AgentOutput = z.infer<typeof agentOutputSchema>;
```

### Prompt Builder with Pre-Fetched Context
```typescript
function buildPrompt(taskDescription: string, contextData: Map<string, string>): string {
  if (contextData.size === 0) {
    return taskDescription;
  }

  const contextSection = [...contextData.entries()]
    .map(([url, content]) => `--- Content from ${url} ---\n${content}\n--- End ---`)
    .join("\n\n");

  return `${taskDescription}\n\nPre-fetched reference data:\n\n${contextSection}`;
}
```

### Database Migration: Add Model Column
```typescript
// In src/db/schema.ts -- add to agents table definition
model: text("model"), // nullable, defaults handled in application code
```

After adding the column, run: `pnpm db:push` (drizzle-kit push for development).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `generateObject()` | `generateText()` + `Output.object()` | AI SDK 6.0 (late 2025) | Must use new API; old one deprecated |
| `zod-to-json-schema` workarounds | Native Zod v4 support | Zod 4.0.4 (July 2025) | No special configuration needed |
| Custom AbortController + setTimeout | `AbortSignal.timeout(ms)` | Node.js 17.3+ | One-liner fetch timeout |
| `usage.promptTokens` / `completionTokens` | `usage.inputTokens` / `outputTokens` | AI SDK 5+ | Different property names than OpenAI convention |

**Deprecated/outdated:**
- `generateObject` / `streamObject`: Deprecated in AI SDK 6; use `generateText`/`streamText` with `Output`
- Manual JSON mode prompting: AI SDK handles this automatically via `Output.object()`

## Open Questions

1. **Model column migration strategy**
   - What we know: Need to add `model` text column to agents table
   - What's unclear: Whether `pnpm db:push` handles additive columns cleanly on existing data
   - Recommendation: Test with existing dev database; drizzle-kit push should handle nullable column addition

2. **html-to-text TypeScript types**
   - What we know: `@types/html-to-text` exists on npm
   - What's unclear: Whether types are current for v9
   - Recommendation: Install `@types/html-to-text`; if types are stale, use the package's built-in types or a thin wrapper

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXEC-01 | Agent sends task to LLM, receives structured response | unit (mocked LLM) | `pnpm vitest run tests/executor.test.ts -t "executes agent"` | No -- Wave 0 |
| EXEC-02 | LLM response validated against Zod schema; retry on failure | unit (mocked LLM) | `pnpm vitest run tests/executor.test.ts -t "validation"` | No -- Wave 0 |
| EXEC-03 | Single agent failure does not crash process or block others | unit | `pnpm vitest run tests/executor.test.ts -t "failure isolation"` | No -- Wave 0 |
| EXEC-04 | Pre-fetch URLs, include data in prompt context | unit (mocked fetch) | `pnpm vitest run tests/prefetch.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/executor.test.ts` -- covers EXEC-01, EXEC-02, EXEC-03 (mock AI SDK, mock DB)
- [ ] `tests/prefetch.test.ts` -- covers EXEC-04 (mock global fetch)
- [ ] `tests/schemas.test.ts` -- covers output schema validation edge cases
- [ ] AI SDK mocking pattern: vi.mock("ai") to intercept generateText calls without hitting real API

## Sources

### Primary (HIGH confidence)
- [AI SDK 6.0 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0) -- generateObject deprecation, Output.object API
- [AI SDK generateText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) -- full parameter and return type documentation
- [AI SDK Anthropic provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic) -- installation, model names, configuration
- [AI SDK structured data generation](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data) -- Output.object pattern, NoObjectGeneratedError

### Secondary (MEDIUM confidence)
- [Zod v4 compatibility fix](https://github.com/vercel/ai/issues/7189) -- confirmed fixed in Zod 4.0.4
- [html-to-text npm](https://www.npmjs.com/package/html-to-text) -- v9, ESM support, TypeScript types

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- verified via official AI SDK docs and migration guide
- Architecture: HIGH -- locked decisions from CONTEXT.md, validated against AI SDK 6 API
- Pitfalls: HIGH -- generateObject deprecation confirmed via official migration guide; token naming confirmed via API reference

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (AI SDK is fast-moving; verify provider versions if delayed)
