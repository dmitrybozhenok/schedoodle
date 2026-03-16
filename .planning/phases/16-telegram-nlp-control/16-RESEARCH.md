# Phase 16: Telegram NLP Control - Research

**Researched:** 2026-03-16
**Domain:** Telegram Bot API polling + LLM-based intent detection for agent management
**Confidence:** HIGH

## Summary

This phase transforms the existing one-way Telegram notification channel into a two-way control interface. Users send natural language messages to the bot, which uses LLM-based intent detection to parse commands (list, run, enable, disable, status, reschedule) and executes the corresponding agent management operations. The implementation requires three new capabilities: (1) a polling loop that fetches incoming messages via the Telegram Bot API `getUpdates` endpoint, (2) an LLM-powered intent parser that extracts action and target agent from free text, and (3) command handlers that wire parsed intents to existing service functions (`executeAgent`, `enrichAgent`, `parseSchedule`, `scheduleAgent`, etc.).

The project already uses direct `fetch` calls to the Telegram Bot API (no third-party library), and all agent management operations exist as functions in the codebase. The LLM structured output pattern (`generateText` + `Output.object` + Zod schema) is well-established from Phase 7's schedule parser. This phase is primarily an integration exercise: connecting Telegram message input to existing management functions through an LLM intent layer.

**Primary recommendation:** Build a polling service (`src/services/telegram-poller.ts`) that runs alongside the scheduler, an intent parser (`src/services/intent-parser.ts`) using the existing `generateText`/`Output.object` pattern, and command handlers (`src/services/telegram-commands.ts`) that map intents to existing service functions. Start the poller from `src/index.ts` after the scheduler starts, and stop it during graceful shutdown.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Full management operations: list agents, run agent by name, enable/disable agents, check status/health
- Schedule changes supported via NL-to-cron parser (e.g., "change morning briefing to 8am")
- No create/delete agents via Telegram (use MCP/API for destructive ops)
- /help and /start commands for discoverability (standard Telegram bot convention)
- When user triggers "run X", bot replies with confirmation ("Running X...") and result comes through the existing notification flow -- no inline result delivery
- LLM-based intent detection for all messages (except /help, /start)
- /help and /start intercepted before LLM call -- zero latency, no token cost
- LLM receives full agent list in prompt for semantic name resolution (e.g., "briefing" resolves to "Morning Briefing Agent")
- LLM picks best match -- no ambiguity confirmation round-trips
- Unrecognized input gets friendly fallback: "I didn't understand that. Here's what I can do: [capabilities]"
- Chat ID restriction only (reuse existing TELEGRAM_CHAT_ID env var from Phase 15)
- No confirmation needed for any operation -- personal tool, if you said it you meant it
- Messages from unauthorized chat IDs silently ignored -- no response, no information leakage
- Concise confirmations: "Running Morning Briefing..." / "Disabled PR Reminder." / "Agents: 1. Morning Briefing (enabled) 2. PR Reminder (disabled)"
- Agent list shows name + status only (enabled/disabled, healthy/unhealthy)
- Error messages include brief guidance: "Agent 'foo' not found. Try: list agents"
- Minimal emojis for status: enabled, disabled, error -- matches Phase 15 notification style

### Claude's Discretion
- Exact LLM prompt structure for intent detection
- Structured output schema for intent extraction (action + params)
- Telegram Bot API webhook vs polling implementation
- How to handle concurrent messages
- Typing indicator behavior

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TGCTL-01 | Telegram bot receives incoming messages via polling (getUpdates) and routes to command handler | Telegram Bot API getUpdates documentation; polling loop architecture pattern |
| TGCTL-02 | /start and /help commands handled directly without LLM call, returning bot capabilities | Direct string matching before LLM dispatch; static response builders |
| TGCTL-03 | Free-text messages parsed by LLM to extract intent and target agent name | generateText + Output.object with Zod intent schema; existing schedule-parser pattern |
| TGCTL-04 | LLM resolves fuzzy agent names from full agent list | Agent list injected into LLM system prompt for semantic matching |
| TGCTL-05 | "Run X" triggers executeAgent and replies with concise confirmation | Existing executeAgent function; fire-and-forget execution pattern |
| TGCTL-06 | "List agents" returns agent names with enabled/disabled and healthy/unhealthy status | Existing enrichAgent helper provides all needed fields |
| TGCTL-07 | "Enable/disable X" toggles agent enabled flag and updates scheduler | DB update + scheduleAgent/removeAgent from scheduler service |
| TGCTL-08 | "Change X to [NL schedule]" updates agent schedule using Phase 7 NL-to-cron parser | Existing parseSchedule function from schedule-parser.ts |
| TGCTL-09 | "Status" or "health" returns concise system health summary | Reuse health route computation logic for text summary |
| TGCTL-10 | Only messages from configured TELEGRAM_CHAT_ID processed; unauthorized silently ignored | Chat ID comparison in polling loop before any processing |
| TGCTL-11 | Unrecognized input gets friendly fallback with help text | LLM returns "unknown" intent; handler replies with capabilities list |
| TGCTL-12 | Error messages include brief guidance | Error handler wraps each command handler with try/catch and guidance |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (Vercel AI SDK) | ^6.0.116 | LLM structured output for intent parsing | Already used throughout project for generateText + Output.object |
| zod | ^4.3.6 | Schema definition for intent extraction | Already used throughout project for all schemas |
| Node fetch (built-in) | N/A | Telegram Bot API HTTP calls | Already used in telegram.ts for sendMessage; no third-party library |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| croner | ^10.0.1 | Cron validation for schedule changes | Already in project; used after parseSchedule for schedule updates |
| drizzle-orm | ^0.45.1 | DB queries for agent lookup/update | Already in project; used for all DB operations |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw fetch polling | telegraf/grammY library | Project convention is no third-party Telegram library; raw fetch is simple and already established |
| LLM intent parsing | Regex/keyword matching | LLM handles fuzzy names, natural phrasing, typos; regex would require extensive pattern matching and miss variations |
| getUpdates polling | Webhook endpoint | Polling is simpler for local/self-hosted use (no public URL needed, no SSL cert required); webhook better for high-volume production |

**No new dependencies needed.** All required libraries already exist in the project.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── services/
│   ├── telegram.ts              # [EXISTS] sendTelegramMessage, escapeMdV2
│   ├── telegram-poller.ts       # [NEW] getUpdates polling loop
│   ├── telegram-commands.ts     # [NEW] Command handlers for each intent
│   └── intent-parser.ts         # [NEW] LLM-based intent extraction
├── schemas/
│   └── telegram-intent.ts       # [NEW] Zod schema for intent extraction
└── index.ts                     # [MODIFY] Start/stop poller alongside scheduler
```

### Pattern 1: Polling Loop with Offset Tracking
**What:** A long-running async loop that calls Telegram's `getUpdates` with offset tracking and a long-poll timeout.
**When to use:** For receiving incoming messages from Telegram Bot API without requiring a public webhook URL.
**Example:**
```typescript
// Source: https://core.telegram.org/bots/api#getupdates
async function pollUpdates(botToken: string, onMessage: (msg: TelegramMessage) => void) {
  let offset = 0;
  while (!stopped) {
    const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset,
        timeout: 30,          // Long-poll: server holds connection up to 30s
        allowed_updates: ["message"],  // Only receive message updates
      }),
    });
    const data = await response.json();
    if (data.ok && data.result.length > 0) {
      for (const update of data.result) {
        offset = update.update_id + 1;  // Acknowledge by advancing offset
        if (update.message?.text) {
          onMessage(update.message);
        }
      }
    }
  }
}
```

### Pattern 2: LLM Intent Extraction with generateText + Output.object
**What:** Use the project's established Vercel AI SDK pattern to extract structured intent from free text.
**When to use:** For parsing user messages into actionable commands with fuzzy agent name resolution.
**Example:**
```typescript
// Source: Existing schedule-parser.ts pattern + ai-sdk.dev docs
import { generateText, Output } from "ai";
import { z } from "zod";

const intentSchema = z.object({
  action: z.enum(["list", "run", "enable", "disable", "status", "reschedule", "unknown"]),
  agentName: z.string().nullable().describe("The resolved agent name from the agent list, or null if not applicable"),
  scheduleInput: z.string().nullable().describe("Natural language schedule for reschedule action, or null"),
});

async function parseIntent(userMessage: string, agentNames: string[]) {
  const model = await resolveModel(DEFAULT_MODEL);
  const agentList = agentNames.map((n, i) => `${i + 1}. ${n}`).join("\n");

  const result = await generateText({
    model,
    output: Output.object({ schema: intentSchema }),
    prompt: `You are a bot that controls scheduled agents.
Available agents:
${agentList}

Parse the user's message and extract their intent.
User message: "${userMessage}"`,
  });

  return result.output;
}
```

### Pattern 3: Command Handler Dispatch
**What:** Map parsed intents to existing service functions via a handler map.
**When to use:** For executing the appropriate management operation based on LLM-extracted intent.
**Example:**
```typescript
// Dispatch pattern matching existing codebase conventions
type CommandResult = { text: string };

const handlers: Record<string, (intent: Intent, db: Database) => Promise<CommandResult>> = {
  list: handleList,
  run: handleRun,
  enable: handleEnable,
  disable: handleDisable,
  status: handleStatus,
  reschedule: handleReschedule,
  unknown: handleUnknown,
};
```

### Pattern 4: Chat ID Security Guard
**What:** Check message sender's chat ID before any processing, silently drop unauthorized messages.
**When to use:** First check in the message processing pipeline.
**Example:**
```typescript
function isAuthorized(chatId: number | string, configuredChatId: string): boolean {
  return String(chatId) === configuredChatId;
}

// In polling callback:
if (!isAuthorized(message.chat.id, env.TELEGRAM_CHAT_ID)) {
  return; // Silent ignore - no response, no log
}
```

### Anti-Patterns to Avoid
- **Processing messages before chat ID check:** Security guard must be the very first thing. Never call the LLM or access the DB for unauthorized messages.
- **Awaiting executeAgent inline:** The "run" command triggers execution fire-and-forget. The bot replies "Running X..." immediately; the result comes through the notification pipeline. Do NOT await the full execution and try to send the result inline.
- **Building agent list every LLM call:** Query agent names once at poller startup and on each command that modifies agents (create/delete would be via API, but enable/disable/reschedule happen here). Cache and refresh as needed to avoid N+1 per message.
- **Using MarkdownV2 for bot replies:** The existing telegram.ts uses MarkdownV2 for notifications, but bot control replies are simple text. Use plain text (no parse_mode) for control responses to avoid escaping headaches. Only use MarkdownV2 if formatting is truly needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agent name fuzzy matching | String similarity algorithm (Levenshtein, etc.) | LLM semantic matching via prompt | LLM handles abbreviations, partial names, synonyms, typos naturally; string similarity would fail on "briefing" -> "Morning Briefing Agent" |
| NL schedule to cron | New schedule parser | `parseSchedule()` from schedule-parser.ts | Full pipeline exists with validation, retries, croner check |
| Agent health computation | Custom health logic | `enrichAgent()` from enrich-agent.ts | Consistent health/status computation across all interfaces |
| System health summary | Duplicate health route logic | Extract shared function from health.ts pattern | Avoid duplicating 24h window queries, status hierarchy, etc. |
| Telegram message sending | New send function | `sendTelegramMessage()` from telegram.ts | Already handles MarkdownV2, link preview options |
| Scheduler updates | Direct cron manipulation | `scheduleAgent()` / `removeAgent()` from scheduler.ts | Handles job registry, replacement, cleanup |

**Key insight:** This phase is an integration phase. Almost every operation already has an existing function. The new code is: (1) polling loop, (2) LLM intent parser, (3) thin command handlers that call existing functions and format responses.

## Common Pitfalls

### Pitfall 1: Offset Management Bugs
**What goes wrong:** Duplicate messages processed or messages lost if offset is not correctly incremented.
**Why it happens:** Forgetting to set offset = max(update_id) + 1 after processing, or crashing before offset update.
**How to avoid:** Always update offset from the last update_id in each batch, even if processing fails. Process updates sequentially within a batch.
**Warning signs:** Bot responding twice to the same message, or missing messages.

### Pitfall 2: Polling Loop Error Recovery
**What goes wrong:** A network error or Telegram API timeout kills the polling loop permanently.
**Why it happens:** Uncaught exception in the fetch/JSON parse breaks the while loop.
**How to avoid:** Wrap the entire fetch+parse in try/catch inside the loop. On error, log and continue with a short delay (e.g., 5 seconds) before retrying. Never let a single failure stop the loop.
**Warning signs:** Bot stops responding to all messages after a network blip.

### Pitfall 3: LLM Latency for Every Message
**What goes wrong:** User sends "list agents" and waits 2-5 seconds for LLM to parse intent.
**Why it happens:** Even simple messages go through LLM processing.
**How to avoid:** Intercept /start and /help before LLM call (as decided). Consider also intercepting obvious keyword-only inputs like "list" or "status" as fast-path if latency is a concern, but the user decided LLM-based parsing for all free text -- honor that decision.
**Warning signs:** Slow response times for simple queries.

### Pitfall 4: Concurrent Message Processing Race Conditions
**What goes wrong:** User sends "disable X" followed immediately by "run X" -- the run might execute before the disable.
**Why it happens:** If messages are processed in parallel.
**How to avoid:** Process messages sequentially within the polling loop (for-of loop, not Promise.all). The polling loop already returns messages in order. Sequential processing is simple and correct for a personal tool.
**Warning signs:** Operations executing out of order.

### Pitfall 5: Stale Agent List in LLM Prompt
**What goes wrong:** LLM can't match agent name because the prompt contains an outdated agent list.
**Why it happens:** Agent list cached at startup and never refreshed after enable/disable/reschedule operations.
**How to avoid:** Query the fresh agent list before each LLM call. The agent count is small (< 100 per project constraints), so querying is cheap (single SQLite query).
**Warning signs:** "Agent not found" errors for recently created agents.

### Pitfall 6: Telegram Bot API Rate Limits
**What goes wrong:** Bot gets throttled by Telegram when sending too many messages.
**Why it happens:** Telegram limits bots to ~30 messages/second to different chats, and 1 message/second to the same chat.
**How to avoid:** For a single-user personal tool, this is unlikely to be an issue. The sequential processing pattern naturally rate-limits responses. No special handling needed.
**Warning signs:** 429 errors from Telegram API.

### Pitfall 7: Long-Running Execution Blocks Polling
**What goes wrong:** "Run X" command triggers executeAgent which takes 30-60 seconds, during which the bot stops responding to other messages.
**Why it happens:** Awaiting executeAgent inside the message handler.
**How to avoid:** Fire-and-forget pattern: call executeAgent without awaiting, reply "Running X..." immediately. The execution result arrives via the existing notification flow. Use `void executeAgent(agent, db).catch(...)` pattern.
**Warning signs:** Bot unresponsive while an agent is executing.

## Code Examples

### Telegram getUpdates Types
```typescript
// Source: https://core.telegram.org/bots/api#update
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string };
  chat: { id: number; type: string };
  text?: string;
  date: number;
}

interface TelegramGetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
  description?: string;
}
```

### Intent Schema (Zod)
```typescript
// Source: Project convention from scheduleParseSchema pattern
import { z } from "zod";

export const telegramIntentSchema = z.object({
  action: z.enum([
    "list",
    "run",
    "enable",
    "disable",
    "status",
    "reschedule",
    "unknown",
  ]).describe("The user's intended action"),
  agentName: z.string().nullable()
    .describe("Exact agent name from the provided list, or null if action doesn't target a specific agent"),
  scheduleInput: z.string().nullable()
    .describe("The natural language schedule text for reschedule action, or null for other actions"),
});

export type TelegramIntent = z.infer<typeof telegramIntentSchema>;
```

### Polling Loop with Graceful Shutdown
```typescript
// Source: Telegram Bot API docs + project shutdown pattern from index.ts
let running = false;

export function startPolling(
  botToken: string,
  chatId: string,
  onMessage: (msg: TelegramMessage) => Promise<void>
) {
  running = true;
  let offset = 0;

  const poll = async () => {
    while (running) {
      try {
        const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset, timeout: 30, allowed_updates: ["message"] }),
        });
        const data = await res.json() as TelegramGetUpdatesResponse;

        if (data.ok && data.result.length > 0) {
          for (const update of data.result) {
            offset = update.update_id + 1;
            if (update.message?.text) {
              // Security: check chat ID first
              if (String(update.message.chat.id) === chatId) {
                await onMessage(update.message);
              }
            }
          }
        }
      } catch (err) {
        console.error(`[telegram] Polling error: ${err instanceof Error ? err.message : err}`);
        // Wait before retry on error
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  };

  void poll();
}

export function stopPolling() {
  running = false;
}
```

### Reply Without MarkdownV2 (Plain Text)
```typescript
// For control responses, send plain text (simpler, no escaping needed)
export async function replyPlainText(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
```

### Fire-and-Forget Run Command
```typescript
// Source: project pattern from executor.ts
async function handleRun(agentName: string, db: Database): Promise<string> {
  const agent = findAgentByName(agentName, db);
  if (!agent) {
    return `Agent "${agentName}" not found. Try: list agents`;
  }
  if (!agent.enabled) {
    return `Agent "${agent.name}" is disabled. Enable it first.`;
  }

  // Fire-and-forget: don't await, result comes via notification flow
  void executeAgent(agent, db).catch(err => {
    console.error(`[telegram] Run "${agent.name}" failed: ${err.message}`);
  });

  return `Running ${agent.name}...`;
}
```

### Agent Lookup by Name (DB Query)
```typescript
// Find agent by exact name or fuzzy match (LLM provides the resolved name)
import { eq, sql } from "drizzle-orm";

function findAgentByName(name: string, db: Database): Agent | undefined {
  // Case-insensitive lookup using the existing COLLATE NOCASE index
  return db.select().from(agents)
    .where(sql`${agents.name} COLLATE NOCASE = ${name} COLLATE NOCASE`)
    .get();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex/keyword intent matching | LLM-based structured output extraction | AI SDK 6 (2025) | Handles natural language variations, fuzzy names, typos |
| Telegram webhook (requires public URL) | getUpdates polling | Always available | Simpler for self-hosted/local deployment |
| Third-party Telegram libraries (telegraf, grammY) | Raw fetch calls to Bot API | Project convention (Phase 15) | No dependency, full control, matches existing telegram.ts |
| generateObject (separate function) | generateText + Output.object (unified) | AI SDK 6 | Same function handles tool calling + structured output |

**Deprecated/outdated:**
- `reply_to_message_id` parameter in sendMessage: replaced by `reply_parameters` object (still works but deprecated style)

## Open Questions

1. **Typing indicator ("typing..." action)**
   - What we know: Telegram's `sendChatAction` API supports action "typing" to show a typing indicator
   - What's unclear: Whether to show typing while LLM processes intent (adds ~2s perceived wait)
   - Recommendation: Show typing indicator for LLM-processed messages. It's a single API call (`sendChatAction` with `action: "typing"`) and gives good UX feedback. Skip for /start and /help since they respond instantly.

2. **Concurrent message handling**
   - What we know: The polling loop returns batches of messages; processing them sequentially is simplest
   - What's unclear: Whether sequential processing is fast enough for the use case
   - Recommendation: Process sequentially. This is a personal tool with one user. Sequential avoids race conditions (e.g., disable then run). LLM call takes ~1-3 seconds, which is acceptable.

3. **Plain text vs MarkdownV2 for bot replies**
   - What we know: Existing notifications use MarkdownV2 with extensive escaping; control replies are simpler
   - What's unclear: Whether to use MarkdownV2 for bold/formatting in control responses
   - Recommendation: Use plain text (no parse_mode) for control responses. This avoids MarkdownV2 escaping complexity for dynamic content. The responses are short and structured enough to be readable without formatting. Only the existing notification pipeline needs MarkdownV2.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TGCTL-01 | Polling loop fetches updates, tracks offset, handles errors | unit | `pnpm vitest run tests/telegram-poller.test.ts -x` | Wave 0 |
| TGCTL-02 | /start and /help return capabilities without LLM call | unit | `pnpm vitest run tests/telegram-commands.test.ts -x` | Wave 0 |
| TGCTL-03 | LLM intent extraction returns structured action + agent | unit | `pnpm vitest run tests/intent-parser.test.ts -x` | Wave 0 |
| TGCTL-04 | Fuzzy agent name resolution via LLM | unit | `pnpm vitest run tests/intent-parser.test.ts -x` | Wave 0 |
| TGCTL-05 | Run command triggers executeAgent, replies confirmation | unit | `pnpm vitest run tests/telegram-commands.test.ts -x` | Wave 0 |
| TGCTL-06 | List command returns agents with status indicators | unit | `pnpm vitest run tests/telegram-commands.test.ts -x` | Wave 0 |
| TGCTL-07 | Enable/disable toggles agent and updates scheduler | unit | `pnpm vitest run tests/telegram-commands.test.ts -x` | Wave 0 |
| TGCTL-08 | Reschedule uses parseSchedule and updates DB + scheduler | unit | `pnpm vitest run tests/telegram-commands.test.ts -x` | Wave 0 |
| TGCTL-09 | Status/health returns system summary | unit | `pnpm vitest run tests/telegram-commands.test.ts -x` | Wave 0 |
| TGCTL-10 | Unauthorized chat IDs silently ignored | unit | `pnpm vitest run tests/telegram-poller.test.ts -x` | Wave 0 |
| TGCTL-11 | Unknown intent returns help text | unit | `pnpm vitest run tests/telegram-commands.test.ts -x` | Wave 0 |
| TGCTL-12 | Error responses include guidance | unit | `pnpm vitest run tests/telegram-commands.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/telegram-poller.test.ts` -- covers TGCTL-01, TGCTL-10 (polling loop, offset, auth)
- [ ] `tests/intent-parser.test.ts` -- covers TGCTL-03, TGCTL-04 (LLM intent schema, mock LLM responses)
- [ ] `tests/telegram-commands.test.ts` -- covers TGCTL-02, TGCTL-05-09, TGCTL-11-12 (all command handlers)

## Sources

### Primary (HIGH confidence)
- [Telegram Bot API - getUpdates](https://core.telegram.org/bots/api#getupdates) - Polling parameters, Update/Message/Chat object structure
- [Telegram Bot API - sendMessage](https://core.telegram.org/bots/api#sendmessage) - Reply parameters, message sending
- [AI SDK - Generating Structured Data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data) - generateText + Output.object pattern
- Project source: `src/services/telegram.ts` - Existing sendTelegramMessage, escapeMdV2
- Project source: `src/services/schedule-parser.ts` - Existing parseSchedule with generateText + Output.object pattern
- Project source: `src/services/executor.ts` - Existing executeAgent function
- Project source: `src/helpers/enrich-agent.ts` - Existing enrichAgent for agent status
- Project source: `src/services/scheduler.ts` - Existing scheduleAgent/removeAgent
- Project source: `src/config/env.ts` - TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID env vars
- Project source: `src/config/llm-provider.ts` - resolveModel, DEFAULT_MODEL

### Secondary (MEDIUM confidence)
- [Telegram Bot API FAQ](https://core.telegram.org/bots/faq) - Rate limits, best practices

### Tertiary (LOW confidence)
- None -- all findings verified against official sources or project code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; all libraries already in project
- Architecture: HIGH - All integration points verified in source code; patterns follow established project conventions
- Pitfalls: HIGH - Based on Telegram Bot API official docs and common polling implementation patterns
- Intent parsing: HIGH - generateText + Output.object pattern directly verified in schedule-parser.ts

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable; all libraries already pinned in project)
