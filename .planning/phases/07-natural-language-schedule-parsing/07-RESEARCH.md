# Phase 7: Natural Language Schedule Parsing - Research

**Researched:** 2026-03-15
**Domain:** Natural language processing, cron expression translation, confirmation UX
**Confidence:** HIGH

## Summary

This phase adds natural language schedule parsing to the Schedoodle API. Users can provide plain English like "every weekday at 9am" instead of writing cron expressions directly. The system translates the input to a cron expression, generates a human-readable confirmation, and lets the user confirm before saving. Two approaches exist: LLM-based translation (using the project's existing AI SDK infrastructure) or a dedicated parsing library. The LLM approach is recommended because the existing NL-to-cron libraries in the npm ecosystem are immature (low download counts, minimal maintenance, limited coverage), while the project already has a battle-tested LLM pipeline with structured output via Vercel AI SDK `generateText` + `Output.object()`.

For the reverse direction (cron-to-human-readable), `cronstrue` (v3.13.0, zero dependencies, actively maintained) is the standard library. It converts any 5/6/7-field cron expression to a readable English string like "At 09:00, Monday through Friday".

**Primary recommendation:** Use the existing LLM infrastructure (`generateText` + `Output.object()` with a Zod schema) for NL-to-cron translation, and `cronstrue` for cron-to-human-readable descriptions. Detect cron vs NL input via regex heuristic. Expose as a new `POST /schedules/parse` endpoint.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Expressions like "every weekday at 9am", "every Monday at 8am", "twice a day", "every 3 hours", "the first of every month" should be parsed into corresponding cron expressions
- Can use LLM-based translation OR a dedicated natural language parsing library -- either approach works
- When a user provides a natural language schedule, show them the interpreted cron expression AND a human-readable description of what it means (e.g. "Runs at 09:00 on Monday through Friday")
- User must confirm before saving
- If the input is ambiguous or can't be parsed, the system should say so clearly and ask the user to rephrase
- Must not guess incorrectly -- prefer clarity over silent assumptions

### Claude's Discretion
- API endpoint design (new endpoint vs extending existing POST/PATCH)
- Whether to use LLM or library for parsing (both acceptable)
- Response format for the confirmation step
- How to detect if input is natural language vs already a cron expression

### Deferred Ideas (OUT OF SCOPE)
None -- user description covers phase scope.
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (Vercel AI SDK) | ^6.0.116 | LLM calls for NL-to-cron translation | Already in project; `generateText` + `Output.object()` with Zod schema provides structured, validated output |
| cronstrue | ^3.13.0 | Cron expression to human-readable string | 3M+ weekly npm downloads, zero dependencies, supports 5/6/7-field cron, actively maintained (last publish: March 2026) |
| croner | ^10.0.1 | Cron expression validation | Already in project; used in Zod schema refine for validating cron expressions |
| zod | ^4.3.6 | Schema validation for LLM output | Already in project; defines structured output shape |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| hono | ^4.12.8 | HTTP routing | Already in project; mount new route |
| @hono/zod-validator | ^0.7.6 | Request body validation | Already in project; validate parse request body |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LLM for NL-to-cron | `@darkeyedevelopers/natural-cron.js` | Library is unmaintained (last update May 2021), handles only simple patterns, no TypeScript types. LLM handles arbitrary phrasing. |
| LLM for NL-to-cron | `crontalk` (cron-talk) | Outputs JS objects, not cron strings; v0.0.24, 68% test coverage, limited grammar. Would need additional layer to produce cron. |
| LLM for NL-to-cron | `natural-cron` | NOT an NL parser -- it's a programmatic builder with chainable methods (`.atTime('17:30').compile()`). Misleading name. |
| cronstrue for readable | LLM for readable | LLM adds latency and cost for a deterministic conversion; cronstrue is instant and reliable |

**Installation:**
```bash
pnpm add cronstrue
```

No other new dependencies needed -- the LLM infrastructure (`ai`, `@ai-sdk/anthropic`, `zod`) is already installed.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── services/
│   └── schedule-parser.ts    # NL-to-cron translation service (LLM call + cronstrue)
├── routes/
│   └── schedules.ts          # POST /schedules/parse endpoint
├── schemas/
│   └── schedule-input.ts     # Zod schemas for request/response validation
└── helpers/
    └── cron-detect.ts        # Heuristic to detect cron vs NL input
```

### Pattern 1: LLM-Based NL-to-Cron Translation
**What:** Use `generateText` with `Output.object()` and a Zod schema to convert natural language to a cron expression. The schema forces the LLM to return both a `cronExpression` string and a `confidence` level.
**When to use:** Every time a user submits a natural language schedule description.
**Example:**
```typescript
// Source: Existing executor.ts pattern + AI SDK docs
import { generateText, Output } from "ai";
import { z } from "zod";

const scheduleParseSchema = z.object({
  cronExpression: z.string().describe("Standard 5-field cron expression (minute hour day-of-month month day-of-week)"),
  confidence: z.enum(["high", "low"]).describe("high if the input clearly maps to a single cron schedule, low if ambiguous"),
  interpretation: z.string().describe("Brief explanation of how the input was interpreted"),
});

export type ScheduleParseResult = z.infer<typeof scheduleParseSchema>;

async function parseNaturalLanguage(input: string): Promise<ScheduleParseResult> {
  const model = await resolveModel(modelId);
  const result = await generateText({
    model,
    output: Output.object({ schema: scheduleParseSchema }),
    prompt: `Convert this natural language schedule description to a standard 5-field cron expression.
Input: "${input}"

Rules:
- Use standard 5-field cron: minute hour day-of-month month day-of-week
- If the input is ambiguous, set confidence to "low"
- Common mappings: "weekday" = Mon-Fri, "daily" = every day, "hourly" = every hour
- "twice a day" = 0 9,17 (9am and 5pm by default)
- "every 3 hours" = 0 */3 * * *`,
  });
  return result.output as ScheduleParseResult;
}
```

### Pattern 2: Cron Expression Detection Heuristic
**What:** Regex-based check to determine if the input is already a valid cron expression vs natural language.
**When to use:** Before deciding whether to pass input through LLM translation or directly validate as cron.
**Example:**
```typescript
// Heuristic: cron expressions are 5 space-separated fields of digits, *, /, -, and comma
const CRON_REGEX = /^(\S+\s+){4}\S+$/;

function looksLikeCron(input: string): boolean {
  const trimmed = input.trim();
  if (!CRON_REGEX.test(trimmed)) return false;
  // Further check: try parsing with croner
  try {
    const job = new Cron(trimmed, { paused: true });
    job.stop();
    return true;
  } catch {
    return false;
  }
}
```

### Pattern 3: Two-Step Confirmation Flow
**What:** The parse endpoint returns the interpreted cron expression and human-readable description. The client then uses the standard `POST /agents` or `PATCH /agents/:id` with the confirmed `cronSchedule` to save.
**When to use:** Always -- user must confirm before the schedule is applied.
**Example response:**
```json
{
  "input": "every weekday at 9am",
  "cronExpression": "0 9 * * 1-5",
  "humanReadable": "At 09:00, Monday through Friday",
  "confidence": "high",
  "interpretation": "Interpreted 'weekday' as Monday through Friday, '9am' as 09:00"
}
```

### Pattern 4: Consistent Error Response Format
**What:** Follow existing Schedoodle error patterns when input is ambiguous or unparseable.
**When to use:** When the LLM returns low confidence or when input cannot be interpreted.
**Example:**
```json
{
  "error": "Could not parse schedule",
  "message": "The input 'sometimes in the morning' is too vague. Try something like 'every weekday at 9am' or 'every 3 hours'.",
  "suggestions": [
    "every day at 9am",
    "every weekday at 9am",
    "every hour"
  ]
}
```

### Anti-Patterns to Avoid
- **Modifying existing POST/PATCH to auto-detect NL:** Changing the semantics of `cronSchedule` field in agent creation/update is dangerous -- existing clients expect a cron expression. Use a separate endpoint instead.
- **Calling LLM for cron-to-human-readable:** This is a deterministic conversion; use cronstrue (zero latency, zero cost, deterministic).
- **Silently accepting low-confidence translations:** If the LLM is unsure, return an error with suggestions instead of saving a potentially wrong schedule.
- **Building a custom NL parser with regex:** The problem space is enormous (time expressions, relative dates, day names, frequency terms). An LLM handles the long tail; regex cannot.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron to human-readable | Custom string formatter | `cronstrue` | Handles all cron syntax variants (L, W, #, ranges), internationalized, zero dependencies, 3M+/week downloads |
| NL to cron translation | Regex-based NL parser | LLM via AI SDK `generateText` + `Output.object()` | Natural language is infinitely variable; existing NL-to-cron libraries cover limited grammar. LLM handles "twice a day", "the first of every month", "every other Tuesday" without hardcoding. |
| Cron expression validation | Custom regex validator | `croner` Cron constructor (already in project) | Already validated in `agent-input.ts` schema; reuse same pattern |

**Key insight:** The NL-to-cron direction is inherently fuzzy and benefits from LLM intelligence. The cron-to-human direction is deterministic and should use a library. Don't mix these approaches.

## Common Pitfalls

### Pitfall 1: LLM Generating Invalid Cron Expressions
**What goes wrong:** The LLM outputs something like `0 9 * * MON-FRI` which looks right but croner may expect `1-5` instead of `MON-FRI` (depends on configuration).
**Why it happens:** LLMs have seen many cron formats; some use names, some use numbers.
**How to avoid:** Always validate LLM output with croner before returning to the user. If validation fails, retry once with error feedback (same pattern as `callLlmWithRetry` in executor.ts).
**Warning signs:** cronstrue generates different description than expected; croner throws on the expression.

### Pitfall 2: Ambiguous Time-of-Day Defaults
**What goes wrong:** User says "every day" -- does that mean midnight? 9am? Noon?
**Why it happens:** Natural language is underspecified about time when only frequency is given.
**How to avoid:** When no time is specified, set confidence to "low" and include the assumed time in the interpretation field. The prompt should instruct the LLM to default to midnight (0 0) for "daily" but flag it.
**Warning signs:** User creates agents that fire at midnight unintentionally.

### Pitfall 3: cronstrue Not Matching Croner Syntax
**What goes wrong:** croner supports some patterns (like `L` for last day) that cronstrue may render differently, or croner accepts patterns cronstrue does not.
**Why it happens:** Different libraries have slightly different cron dialect support.
**How to avoid:** Generate only standard 5-field cron expressions from the LLM (minute hour day-of-month month day-of-week). Avoid extended syntax (L, W, #) in generated expressions. Validate with croner, describe with cronstrue.
**Warning signs:** cronstrue throws "Error: Expression has too many parts" or produces garbled output.

### Pitfall 4: Circuit Breaker Blocking Schedule Parsing
**What goes wrong:** If the LLM provider is down (circuit breaker open), NL parsing fails entirely.
**Why it happens:** The parse endpoint uses the same LLM provider as agent execution.
**How to avoid:** Return a clear error: "Schedule parsing is temporarily unavailable. Please provide a cron expression directly (e.g., 0 9 * * 1-5)." Allow the user to fall back to raw cron input.
**Warning signs:** 503 responses from parse endpoint correlating with LLM outages.

### Pitfall 5: Importing cronstrue Incorrectly (ESM vs CJS)
**What goes wrong:** `import cronstrue from 'cronstrue'` may not work as expected in ESM context.
**Why it happens:** cronstrue has both CJS and ESM builds; default export handling varies.
**How to avoid:** Use `import cronstrue from 'cronstrue'` and verify it works. If it does not, try `import { toString } from 'cronstrue'` or `import * as cronstrue from 'cronstrue'`.
**Warning signs:** `cronstrue.toString is not a function` at runtime.

## Code Examples

Verified patterns from official sources and existing project code:

### Using cronstrue for Human-Readable Descriptions
```typescript
// Source: cronstrue npm / GitHub README
import cronstrue from "cronstrue";

// Standard 5-field cron
cronstrue.toString("0 9 * * 1-5");  // "At 09:00, Monday through Friday"
cronstrue.toString("*/5 * * * *");   // "Every 5 minutes"
cronstrue.toString("0 0 1 * *");     // "At 00:00, on day 1 of the month"
cronstrue.toString("0 */3 * * *");   // "Every 3 hours"
cronstrue.toString("0 9,17 * * *");  // "At 09:00 and 17:00"
```

### LLM-Based Parsing with Retry (Following Project Pattern)
```typescript
// Source: Existing callLlmWithRetry pattern in src/services/executor.ts
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { Cron } from "croner";

async function parseScheduleWithRetry(
  model: LanguageModel,
  input: string,
): Promise<ScheduleParseResult> {
  const prompt = buildParsePrompt(input);
  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: scheduleParseSchema }),
      prompt,
    });
    const parsed = result.output as ScheduleParseResult;
    // Validate the generated cron expression with croner
    const job = new Cron(parsed.cronExpression, { paused: true });
    job.stop();
    return parsed;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      // Retry once with feedback
      const errorMsg = error instanceof Error ? error.message : String(error);
      const retryPrompt = `${prompt}\n\n[Previous attempt failed: ${errorMsg}]\nPlease provide a valid 5-field cron expression.`;
      const result = await generateText({
        model,
        output: Output.object({ schema: scheduleParseSchema }),
        prompt: retryPrompt,
      });
      return result.output as ScheduleParseResult;
    }
    throw error;
  }
}
```

### Cron Detection Heuristic
```typescript
// Source: Project pattern (croner validation in agent-input.ts)
import { Cron } from "croner";

/**
 * Detect whether input looks like a cron expression or natural language.
 * Returns true if the input is a valid cron expression.
 */
export function isCronExpression(input: string): boolean {
  const trimmed = input.trim();
  // Quick reject: must have exactly 4 spaces (5 fields)
  const fields = trimmed.split(/\s+/);
  if (fields.length < 5 || fields.length > 7) return false;
  // Fields should only contain cron-valid characters
  const cronChars = /^[0-9*\/,\-?LW#]+$/;
  if (!fields.every((f) => cronChars.test(f))) return false;
  // Final validation with croner
  try {
    const job = new Cron(trimmed, { paused: true });
    job.stop();
    return true;
  } catch {
    return false;
  }
}
```

### Route Handler Following Project Conventions
```typescript
// Source: Existing createAgentRoutes pattern in src/routes/agents.ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

const parseScheduleBody = z.object({
  input: z.string().min(1).max(500),
});

export function createScheduleRoutes(): Hono {
  const app = new Hono();

  app.post("/parse", zValidator("json", parseScheduleBody, zodErrorHook), async (c) => {
    const { input } = c.req.valid("json");

    // If already a cron expression, just describe it
    if (isCronExpression(input)) {
      const humanReadable = cronstrue.toString(input);
      return c.json({
        input,
        cronExpression: input,
        humanReadable,
        confidence: "high",
        interpretation: "Input is already a valid cron expression",
      });
    }

    // Parse natural language via LLM
    try {
      const result = await parseSchedule(input);
      if (result.confidence === "low") {
        return c.json({
          ...result,
          warning: "This interpretation may not match your intent. Please verify.",
        });
      }
      return c.json(result);
    } catch (error) {
      return c.json({
        error: "Could not parse schedule",
        message: "Unable to interpret the schedule description. Try a simpler phrase like 'every weekday at 9am'.",
      }, 422);
    }
  });

  return app;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex-based NL parsers (chrono, natural-cron.js) | LLM structured output for NL-to-cron | 2024-2025 with mature AI SDKs | Handles arbitrary phrasing without maintaining grammar rules |
| prettycron for cron descriptions | cronstrue (actively maintained, i18n) | cronstrue has been standard since ~2020 | Better i18n, more format support, zero deps |
| generateObject (AI SDK <6) | generateText + Output.object (AI SDK 6+) | AI SDK 6.0 release | Unified API, same pattern project already uses |

**Deprecated/outdated:**
- `prettycron`: Lower download count, less maintained than cronstrue
- `natural-cron.js`: Last updated May 2021, no TypeScript, limited grammar
- `crontalk`: v0.0.24, outputs JS objects not cron strings, 68% test coverage

## Open Questions

1. **LLM Model Selection for Parsing**
   - What we know: Project uses configurable provider (Anthropic/Ollama) with a default model. Haiku 4.5 is the default Anthropic model.
   - What's unclear: Whether the cheapest model (Haiku) is accurate enough for cron generation, or if this task needs a more capable model.
   - Recommendation: Use the same model resolution as agent execution (DEFAULT_MODEL or agent-level override is not applicable here, so use DEFAULT_MODEL). Haiku 4.5 should handle this well -- it is a simple structured extraction task. Test with the example inputs from CONTEXT.md.

2. **Integration with Existing Agent Create/Update Flow**
   - What we know: The parse endpoint is separate from agent CRUD. Users call parse, get confirmation, then call POST/PATCH with the confirmed cronSchedule.
   - What's unclear: Whether the PATCH/POST endpoints should also accept natural language directly (with auto-parse + auto-confirm).
   - Recommendation: Keep it simple -- parse endpoint only. Do not modify existing CRUD semantics. The confirmation step is a user requirement.

3. **Rate Limiting for Parse Endpoint**
   - What we know: Each parse call costs an LLM invocation (tokens + latency).
   - What's unclear: Whether this personal-use tool needs rate limiting.
   - Recommendation: No rate limiting for v1 (personal tool, runs on localhost per REQUIREMENTS.md out-of-scope section). Note as future consideration.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NLP-01 | NL input produces valid cron expression | unit | `pnpm exec vitest run tests/schedule-parser.test.ts -t "produces valid cron" -x` | No - Wave 0 |
| NLP-02 | Cron input detected and described without LLM call | unit | `pnpm exec vitest run tests/cron-detect.test.ts -x` | No - Wave 0 |
| NLP-03 | cronstrue produces human-readable for generated cron | unit | `pnpm exec vitest run tests/schedule-parser.test.ts -t "human readable" -x` | No - Wave 0 |
| NLP-04 | Low confidence returns warning | unit | `pnpm exec vitest run tests/schedule-parser.test.ts -t "low confidence" -x` | No - Wave 0 |
| NLP-05 | Unparseable input returns 422 with guidance | unit | `pnpm exec vitest run tests/routes-schedules.test.ts -t "unparseable" -x` | No - Wave 0 |
| NLP-06 | POST /schedules/parse route with valid NL input | unit | `pnpm exec vitest run tests/routes-schedules.test.ts -t "parse" -x` | No - Wave 0 |
| NLP-07 | Circuit breaker open returns graceful error | unit | `pnpm exec vitest run tests/routes-schedules.test.ts -t "circuit" -x` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/schedule-parser.test.ts` -- covers NLP-01, NLP-03, NLP-04 (mock LLM, real cronstrue)
- [ ] `tests/cron-detect.test.ts` -- covers NLP-02 (pure function, no mocks)
- [ ] `tests/routes-schedules.test.ts` -- covers NLP-05, NLP-06, NLP-07 (mock LLM service, test Hono route)

## Sources

### Primary (HIGH confidence)
- cronstrue npm package (v3.13.0) -- cron to human-readable, verified via npm info
- croner npm package (v10.0.1) -- already installed, cron validation, verified in project's package.json
- Vercel AI SDK docs (ai-sdk.dev) -- `generateText` + `Output.object()` structured output pattern
- Existing project source code -- executor.ts, agent-input.ts, routes/agents.ts patterns

### Secondary (MEDIUM confidence)
- [cRonstrue GitHub README](https://github.com/bradymholt/cRonstrue) -- API examples, 5/6/7-field support
- [AI SDK structured data docs](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data) -- Output.object schema usage
- [natural-cron.js GitHub](https://github.com/darkeyedevelopers/natural-cron.js) -- evaluated and rejected (unmaintained)
- [cron-talk GitHub](https://github.com/lud77/cron-talk) -- evaluated and rejected (outputs objects, not cron strings)

### Tertiary (LOW confidence)
- [natural-cron npm](https://github.com/satyajitnayk/natural-cron) -- misleading name, is a builder not a parser (verified via docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - cronstrue is the undisputed standard for cron-to-human-readable. LLM approach leverages existing, proven project infrastructure.
- Architecture: HIGH - follows existing project patterns (factory routes, Zod validation, service layer). No architectural novelty.
- Pitfalls: MEDIUM - LLM output quality for cron generation is hypothesis until tested with the specific model (Haiku 4.5). Cronstrue ESM import compatibility needs verification at install time.

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable domain, cronstrue and AI SDK are mature)
