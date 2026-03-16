# Phase 18: Implement Scheduling via Telegram Chat - Research

**Researched:** 2026-03-16
**Domain:** Telegram bot agent lifecycle management (create, delete, edit, rename)
**Confidence:** HIGH

## Summary

Phase 18 extends the existing Telegram bot (Phase 16) with full agent lifecycle management: create, delete (with confirmation), edit task descriptions, and rename agents -- all via natural language messages. The implementation is primarily an extension of two existing modules: `telegram-commands.ts` (new handler functions + switch cases) and `telegram-intent.ts` / `intent-parser.ts` (new actions + fields in the schema/prompt).

The codebase is well-established with clear patterns from Phase 16. Every new capability maps directly to existing REST API operations in `routes/agents.ts`, meaning the Telegram handlers can reuse the same Drizzle queries and scheduler integration. The main engineering challenges are: (1) the pending deletion state machine with timeout cleanup, (2) extending the intent schema without breaking existing actions, and (3) handling the `cronSchedule` NOT NULL constraint for schedule-less agent creation.

**Primary recommendation:** Extend `telegramIntentSchema` with 4 new actions and 2 new nullable fields, add 4 handler functions following existing patterns, and implement pending deletion as an in-memory Map with setTimeout cleanup.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Single-message creation: user sends one message like "create Morning Briefing that runs daily at 7am and summarizes my emails"
- LLM extracts name, task description, and optional schedule from the message
- Required fields: name and task description. If either is missing, reject with guidance and example
- Optional: schedule (if omitted, agent created as disabled with no cron job)
- No system prompt extraction -- system prompt stays API/MCP-only
- If schedule is provided, agent is auto-enabled and immediately registered with the scheduler
- If no schedule, agent is created disabled (enabled=0)
- No conversation state for creation -- reject with guidance if incomplete, user resends
- Delete supported via Telegram with a confirmation step
- "delete X" triggers a confirmation prompt with time-limited pending state (60s)
- In-memory Map<chatId, { agentId, agentName, expiresAt }> for pending deletions
- "yes"/"confirm" within 60 seconds executes the delete; "no"/"cancel" clears it
- Any other message clears the pending deletion and processes the new message normally
- 60-second timeout auto-clears the pending state
- Delete cascades to execution history (matches existing API DELETE behavior)
- Scheduler job removed on deletion
- Task description editable: "update X task to ..."
- Name editable: "rename X to Y"
- System prompt NOT editable via Telegram
- Schedule changes already handled by Phase 16's reschedule command
- Extend existing telegramIntentSchema with new actions: create, delete, update_task, rename
- Add new nullable fields: taskDescription, newName, cronSchedule (for create)
- Single parseIntent() call handles all actions
- LLM prompt updated with new action descriptions and extraction rules
- Creation confirmation echoes: name, human-readable schedule, task description, enabled status
- Deletion confirmation shows what will be removed before user confirms
- Edit confirmations are concise
- Duplicate name on create: reject with guidance
- Missing fields on create: reject with example message
- Error messages include actionable guidance
- Help text updated to include all new capabilities

### Claude's Discretion
- Exact LLM prompt wording for new action extraction
- How to structure the pending deletion cleanup (setTimeout vs check-on-access)
- Whether to add cronSchedule field or reuse scheduleInput for create's schedule extraction
- Test structure for new command handlers

### Deferred Ideas (OUT OF SCOPE)
- System prompt editing via Telegram
- Step-by-step conversational agent creation
- Agent cloning via Telegram ("clone X as Y")
- Batch operations ("disable all agents", "delete all disabled")
</user_constraints>

## Standard Stack

### Core (Already Installed -- No New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai | ^6.0.116 | LLM intent parsing via generateText + Output.object | Already used in intent-parser.ts |
| zod | ^4.3.6 | Intent schema validation | Already used for telegramIntentSchema |
| drizzle-orm | ^0.45.1 | Database queries (insert/update/delete agents) | Already used throughout codebase |
| cronstrue | ^3.13.0 | Human-readable cron descriptions for creation confirmation | Already used in schedule-parser.ts |
| croner | ^10.0.1 | Cron schedule validation + scheduler registration | Already used in scheduler.ts |

### Supporting (Already Available)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| schedule-parser.ts | internal | NL-to-cron translation for create's optional schedule | When user provides schedule in create message |
| cron-detect.ts | internal | Fast-path cron expression detection | When schedule input might be raw cron |
| enrich-agent.ts | internal | Consistent agent response shape | For creation confirmation echoing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory Map for pending deletions | SQLite table | Overkill for single-user bot; in-memory is simpler and auto-clears on restart |
| setTimeout for expiry cleanup | Check-on-access lazy cleanup | setTimeout is more predictable; check-on-access leaves stale entries until next message |

**Installation:** No new packages needed. All dependencies are already installed.

## Architecture Patterns

### Files to Modify
```
src/
  schemas/
    telegram-intent.ts     # Extend action enum + add new nullable fields
  services/
    intent-parser.ts       # Update system prompt with new action descriptions
    telegram-commands.ts   # Add handleCreate, handleDelete, handleUpdateTask, handleRename + pending deletion state
tests/
  telegram-commands.test.ts # New test cases for create, delete, update_task, rename
  intent-parser.test.ts     # New test cases for new actions
```

### No New Files Needed
All changes fit within existing module boundaries. No new services, schemas, or helpers required.

### Pattern 1: Intent Schema Extension
**What:** Add new actions and fields to the Zod schema that the LLM outputs.
**When to use:** Extending bot capabilities with new command types.
**Key decision:** Use `scheduleInput` (existing field) for create's schedule extraction rather than adding a new `cronSchedule` field. Rationale: `scheduleInput` already represents "natural language schedule text" and is already nullable. The LLM already knows how to extract schedule descriptions into this field from the reschedule action. Reusing it avoids schema bloat and keeps the LLM prompt simpler.

```typescript
// src/schemas/telegram-intent.ts
export const telegramIntentSchema = z.object({
  action: z
    .enum([
      "list", "run", "enable", "disable", "status", "reschedule",
      "create", "delete", "update_task", "rename",
      "unknown",
    ])
    .describe("The user's intended action"),
  agentName: z
    .string()
    .nullable()
    .describe("Exact agent name from the provided list, or the new agent name for create"),
  scheduleInput: z
    .string()
    .nullable()
    .describe("Natural language schedule text for reschedule or create actions, or null"),
  taskDescription: z
    .string()
    .nullable()
    .describe("Task description for create or update_task actions, or null"),
  newName: z
    .string()
    .nullable()
    .describe("New name for rename action, or null"),
});
```

### Pattern 2: Pending Deletion State Machine
**What:** In-memory Map tracking deletion confirmations with time-limited expiry.
**When to use:** Two-step destructive operations in a stateless message handler.
**Recommendation:** Use setTimeout for cleanup (not check-on-access). This ensures stale entries are cleared even if no new messages arrive.

```typescript
// In telegram-commands.ts
interface PendingDeletion {
  agentId: number;
  agentName: string;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const pendingDeletions = new Map<string, PendingDeletion>();

function setPendingDeletion(chatId: string, agentId: number, agentName: string): void {
  clearPendingDeletion(chatId);  // Clear any existing
  const timer = setTimeout(() => pendingDeletions.delete(chatId), 60_000);
  pendingDeletions.set(chatId, {
    agentId,
    agentName,
    expiresAt: Date.now() + 60_000,
    timer,
  });
}

function clearPendingDeletion(chatId: string): void {
  const existing = pendingDeletions.get(chatId);
  if (existing) {
    clearTimeout(existing.timer);
    pendingDeletions.delete(chatId);
  }
}
```

### Pattern 3: Message Handler Flow with Pending Deletion Check
**What:** Check for pending deletion before LLM parsing. "yes"/"confirm" executes delete; "no"/"cancel" clears; anything else clears and processes normally.
**When to use:** Before the existing LLM intent parsing step.

```typescript
// In handleTelegramMessage, after /start /help check but before parseIntent:
const pending = pendingDeletions.get(chatId);
if (pending) {
  const lowerText = text.toLowerCase();
  if (lowerText === "yes" || lowerText === "confirm") {
    clearPendingDeletion(chatId);
    reply = handleConfirmDelete(pending, db);
    await sendPlainText(botToken, chatId, reply);
    return;
  }
  if (lowerText === "no" || lowerText === "cancel") {
    clearPendingDeletion(chatId);
    await sendPlainText(botToken, chatId, "Deletion cancelled.");
    return;
  }
  // Any other message: clear pending and process normally
  clearPendingDeletion(chatId);
}
```

### Pattern 4: Agent Creation Handler
**What:** Insert agent into DB, optionally parse schedule, register with scheduler if enabled.
**When to use:** When intent.action === "create".

```typescript
async function handleCreate(
  agentName: string,
  taskDescription: string,
  scheduleInput: string | null,
  db: Database,
): Promise<string> {
  // Check duplicate name
  const existing = findAgentByName(agentName, db);
  if (existing) {
    return `Agent "${agentName}" already exists. Use "update ${agentName} task to ..." to modify it.`;
  }

  let cronSchedule: string | null = null;
  let humanReadable: string | null = null;
  if (scheduleInput) {
    try {
      const result = await parseSchedule(scheduleInput);
      cronSchedule = result.cronExpression;
      humanReadable = result.humanReadable;
    } catch {
      return `Could not parse schedule "${scheduleInput}". Try a different description, or create without a schedule.`;
    }
  }

  const now = new Date().toISOString();
  const enabled = cronSchedule ? 1 : 0;
  const created = db.insert(agents).values({
    name: agentName,
    taskDescription,
    cronSchedule: cronSchedule ?? "",  // See DB constraint note below
    enabled,
    createdAt: now,
    updatedAt: now,
  }).returning().get();

  if (enabled === 1 && cronSchedule) {
    scheduleAgent(created, db);
  }

  const lines = [`Created "${created.name}".`];
  lines.push(`Task: ${taskDescription}`);
  if (humanReadable) {
    lines.push(`Schedule: ${humanReadable} (${cronSchedule})`);
    lines.push("Status: enabled");
  } else {
    lines.push("Schedule: none (disabled)");
    lines.push("Status: disabled -- set a schedule to enable");
  }
  return lines.join("\n");
}
```

### Anti-Patterns to Avoid
- **Multi-turn conversation state for creation:** The user decided against this. Reject incomplete messages with guidance; don't maintain conversation context.
- **Separate parsers per action:** Use a single parseIntent() call. Don't add separate LLM calls for different actions.
- **Modifying system prompt via Telegram:** Explicitly deferred. Don't add systemPrompt extraction to the intent schema.
- **Global variable for pending deletions without cleanup:** Always use setTimeout to auto-clear expired entries. Store the timer reference so it can be cleared on explicit cancel.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NL schedule parsing | Custom regex/NLP | `parseSchedule()` from schedule-parser.ts | Already handles NL-to-cron with LLM, validation, and cronstrue descriptions |
| Cron expression detection | String heuristics | `isCronExpression()` from cron-detect.ts | Already validates with croner, handles edge cases |
| Agent enrichment | Manual field computation | `enrichAgent()` from enrich-agent.ts | Consistent API shape with health, next run, etc. |
| Agent name lookup | Raw SQL | `findAgentByName()` in telegram-commands.ts | Already handles case-insensitive COLLATE NOCASE |
| LLM structured output | Manual JSON parsing | AI SDK `Output.object({ schema })` with NoObjectGeneratedError retry | Established pattern in intent-parser.ts |

**Key insight:** Every new handler is a thin wrapper around existing DB operations and services. The only genuinely new code is the pending deletion state machine and the intent schema/prompt extension.

## Common Pitfalls

### Pitfall 1: cronSchedule NOT NULL Constraint
**What goes wrong:** The DB schema defines `cronSchedule: text("cron_schedule").notNull()`. Creating an agent without a schedule would violate this constraint.
**Why it happens:** Phase 3 designed agents to always have a schedule. Phase 18 introduces schedule-optional creation via Telegram.
**How to avoid:** Use an empty string `""` as the sentinel value for "no schedule." When displaying or using the schedule, check for empty string. Do NOT modify the DB schema (would require migration and affect all other code paths).
**Warning signs:** SQLite constraint violation error on insert.

### Pitfall 2: Execution History is NOT Cascaded on Delete
**What goes wrong:** CONTEXT.md says "Delete cascades to execution history" but the actual schema uses `onDelete: "set null"` for `executionHistory.agentId`. The agentTools table uses `onDelete: "cascade"`.
**Why it happens:** The API DELETE works correctly because set null effectively orphans the records. But the confirmation message should accurately describe what happens.
**How to avoid:** In the delete confirmation message, say "removes the agent and disconnects its execution history" rather than "removes all execution history." The actual behavior is identical to the REST API DELETE.
**Warning signs:** Misleading confirmation messages.

### Pitfall 3: Pending Deletion Timer Leak on Shutdown
**What goes wrong:** setTimeout timers keep the Node.js process alive during graceful shutdown.
**Why it happens:** Active timers prevent the event loop from draining.
**How to avoid:** Either (a) call `timer.unref()` on creation so the timer doesn't prevent exit, or (b) export a cleanup function called during shutdown. Option (a) is simpler and matches the rate limiter pattern from Phase 10.
**Warning signs:** Process hangs on SIGINT/SIGTERM.

### Pitfall 4: Intent Parser Prompt Becomes Too Complex
**What goes wrong:** Adding 4 new actions with extraction rules makes the system prompt unwieldy, causing LLM confusion between similar actions (update_task vs reschedule vs rename).
**Why it happens:** The single-prompt approach handles all actions in one LLM call.
**How to avoid:** Use clear, distinct action names in the prompt. Provide explicit disambiguation rules (e.g., "If the user says 'change X schedule to Y', use reschedule. If they say 'update X task to Y', use update_task. If they say 'rename X to Y', use rename."). Include examples for each action.
**Warning signs:** LLM confuses update_task with reschedule, or rename with update_task.

### Pitfall 5: Pending Deletion Checked After parseIntent
**What goes wrong:** If pending deletion check happens after the LLM call, a "yes" response would be parsed as intent (likely "unknown") instead of confirming the deletion.
**Why it happens:** Wrong insertion point in the handler flow.
**How to avoid:** Check pending deletion state BEFORE calling parseIntent. The check must be: slash commands -> pending deletion check -> LLM intent parsing -> dispatch.
**Warning signs:** "yes" replies trigger "I didn't understand that" instead of executing the delete.

### Pitfall 6: Case Sensitivity in Confirmation
**What goes wrong:** User types "Yes" or "YES" and it doesn't match the string comparison.
**Why it happens:** Strict string equality without normalization.
**How to avoid:** Always `.toLowerCase()` the text before comparing to "yes", "confirm", "no", "cancel". CONTEXT.md explicitly requires case-insensitive confirmation.

## Code Examples

### Extended Intent Schema (Full)
```typescript
// src/schemas/telegram-intent.ts
import { z } from "zod";

export const telegramIntentSchema = z.object({
  action: z
    .enum([
      "list", "run", "enable", "disable", "status", "reschedule",
      "create", "delete", "update_task", "rename",
      "unknown",
    ])
    .describe("The user's intended action"),
  agentName: z
    .string()
    .nullable()
    .describe(
      "Exact agent name from the provided list, or the new agent name for 'create' action, or null for list/status/unknown",
    ),
  scheduleInput: z
    .string()
    .nullable()
    .describe(
      "Natural language schedule text for reschedule or create actions, or null for other actions",
    ),
  taskDescription: z
    .string()
    .nullable()
    .describe(
      "Task description for create or update_task actions, or null for other actions",
    ),
  newName: z
    .string()
    .nullable()
    .describe(
      "New name for rename action, or null for other actions",
    ),
});

export type TelegramIntent = z.infer<typeof telegramIntentSchema>;
```

### Updated Help Text
```typescript
const HELP_TEXT = `I can help you manage your agents. Try:

- "list agents" - show all agents
- "run [agent name]" - execute an agent
- "enable [agent name]" - enable an agent
- "disable [agent name]" - disable an agent
- "status" - system health summary
- "change [agent name] to [schedule]" - update schedule
- "create [name] that [does task] every [schedule]" - create a new agent
- "delete [agent name]" - delete an agent (with confirmation)
- "update [agent name] task to [description]" - change task
- "rename [agent name] to [new name]" - rename an agent

Commands: /help, /start`;
```

### Handler Message Flow (Updated)
```typescript
export async function handleTelegramMessage(message: TelegramMessage, db: Database): Promise<void> {
  const text = message.text?.trim() ?? "";
  const chatId = String(message.chat.id);
  const botToken = env.TELEGRAM_BOT_TOKEN as string;

  // 1. Slash commands bypass everything
  if (text.toLowerCase() === "/start" || text.toLowerCase() === "/help") {
    await sendPlainText(botToken, chatId, handleHelp());
    return;
  }

  // 2. Check pending deletion BEFORE LLM
  const pending = pendingDeletions.get(chatId);
  if (pending && pending.expiresAt > Date.now()) {
    const lower = text.toLowerCase();
    if (lower === "yes" || lower === "confirm") {
      clearPendingDeletion(chatId);
      const reply = handleConfirmDelete(pending, db);
      await sendPlainText(botToken, chatId, reply);
      return;
    }
    if (lower === "no" || lower === "cancel") {
      clearPendingDeletion(chatId);
      await sendPlainText(botToken, chatId, "Deletion cancelled.");
      return;
    }
    // Other message: clear pending and fall through to normal processing
    clearPendingDeletion(chatId);
  }

  // 3. Typing indicator + LLM intent parsing
  await sendTypingAction(botToken, chatId).catch(() => {});
  // ... existing parseIntent + dispatch logic with new cases
}
```

### Delete Confirmation Handler
```typescript
function handleConfirmDelete(pending: PendingDeletion, db: Database): string {
  // Re-check agent still exists
  const agent = db.select().from(agents).where(eq(agents.id, pending.agentId)).get();
  if (!agent) {
    return `Agent "${pending.agentName}" no longer exists.`;
  }

  removeAgent(agent.id);
  db.delete(agents).where(eq(agents.id, agent.id)).run();

  return `Deleted "${agent.name}" and removed its scheduled job.`;
}
```

### Update Task Handler
```typescript
function handleUpdateTask(agentName: string, taskDescription: string, db: Database): string {
  const agent = findAgentByName(agentName, db);
  if (!agent) return `Agent "${agentName}" not found. Try: list agents`;

  db.update(agents)
    .set({ taskDescription, updatedAt: new Date().toISOString() })
    .where(eq(agents.id, agent.id))
    .run();

  return `Updated ${agent.name} task.`;
}
```

### Rename Handler
```typescript
function handleRename(agentName: string, newName: string, db: Database): string {
  const agent = findAgentByName(agentName, db);
  if (!agent) return `Agent "${agentName}" not found. Try: list agents`;

  // Check new name doesn't conflict
  const conflict = findAgentByName(newName, db);
  if (conflict) return `Name "${newName}" is already taken. Choose a different name.`;

  try {
    db.update(agents)
      .set({ name: newName, updatedAt: new Date().toISOString() })
      .where(eq(agents.id, agent.id))
      .run();
    return `Renamed "${agent.name}" to "${newName}".`;
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      return `Name "${newName}" is already taken. Choose a different name.`;
    }
    throw err;
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 16: 7 actions (list, run, enable, disable, status, reschedule, unknown) | Phase 18: 11 actions (+ create, delete, update_task, rename) | This phase | Full agent lifecycle via Telegram |
| No stateful interactions | Pending deletion with 60s timeout | This phase | First time bot maintains conversation state (limited, single-step) |
| Agent always has schedule | Agent can be created without schedule (disabled) | This phase | cronSchedule empty string sentinel |

**Deprecated/outdated:** None -- all existing Phase 16 functionality remains as-is.

## Open Questions

1. **cronSchedule empty string vs schema migration**
   - What we know: DB schema has `cronSchedule.notNull()`. Creating without schedule requires a sentinel value or schema change.
   - What's unclear: Whether empty string causes issues with croner Cron constructor or other consumers.
   - Recommendation: Use empty string `""`. Verify that `getNextRunAt()` and `scheduleAgent()` handle empty string gracefully (they should not be called for disabled agents, but add a guard). Do NOT alter the DB schema -- too much downstream impact.

2. **Reuse scheduleInput vs new cronSchedule field**
   - What we know: `scheduleInput` already serves the "natural language schedule" purpose for reschedule.
   - What's unclear: Whether the LLM can reliably use the same field for both create's schedule and reschedule's schedule.
   - Recommendation: Reuse `scheduleInput`. The semantic is identical ("natural language schedule text"). Add clear prompt rules: "For 'create' with a schedule, extract schedule into scheduleInput. For 'create' without a schedule, set scheduleInput to null."

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm vitest run tests/telegram-commands.test.ts tests/intent-parser.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P18-01 | Create action extracts name + task + optional schedule | unit | `pnpm vitest run tests/intent-parser.test.ts -t "create"` | Extend existing |
| P18-02 | Create handler inserts agent, echoes confirmation | unit | `pnpm vitest run tests/telegram-commands.test.ts -t "create"` | Extend existing |
| P18-03 | Create without schedule sets disabled | unit | `pnpm vitest run tests/telegram-commands.test.ts -t "create.*disabled"` | Extend existing |
| P18-04 | Create with schedule enables + registers cron | unit | `pnpm vitest run tests/telegram-commands.test.ts -t "create.*schedule"` | Extend existing |
| P18-05 | Duplicate name on create rejected | unit | `pnpm vitest run tests/telegram-commands.test.ts -t "create.*exists"` | Extend existing |
| P18-06 | Delete triggers confirmation prompt | unit | `pnpm vitest run tests/telegram-commands.test.ts -t "delete.*confirm"` | Extend existing |
| P18-07 | "yes" within 60s executes delete | unit | `pnpm vitest run tests/telegram-commands.test.ts -t "yes.*delete"` | Extend existing |
| P18-08 | "no" cancels pending deletion | unit | `pnpm vitest run tests/telegram-commands.test.ts -t "cancel.*delete"` | Extend existing |
| P18-09 | Other message clears pending + processes normally | unit | `pnpm vitest run tests/telegram-commands.test.ts -t "clears pending"` | Extend existing |
| P18-10 | Update task modifies taskDescription | unit | `pnpm vitest run tests/telegram-commands.test.ts -t "update_task"` | Extend existing |
| P18-11 | Rename changes agent name | unit | `pnpm vitest run tests/telegram-commands.test.ts -t "rename"` | Extend existing |
| P18-12 | Help text includes new capabilities | unit | `pnpm vitest run tests/telegram-commands.test.ts -t "help.*create"` | Extend existing |
| P18-13 | Schema accepts new actions and fields | unit | `pnpm vitest run tests/intent-parser.test.ts -t "create\|delete\|update_task\|rename"` | Extend existing |

### Sampling Rate
- **Per task commit:** `pnpm vitest run tests/telegram-commands.test.ts tests/intent-parser.test.ts`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. Tests are added by extending `tests/telegram-commands.test.ts` and `tests/intent-parser.test.ts` which already have the mock structure and helper utilities in place.

## Sources

### Primary (HIGH confidence)
- Direct source code inspection of all canonical reference files listed in CONTEXT.md
- `src/schemas/telegram-intent.ts` -- Current intent schema (7 actions, 3 fields)
- `src/services/telegram-commands.ts` -- Current handler structure (269 lines, 8 handlers)
- `src/services/intent-parser.ts` -- LLM parsing pattern with retry
- `src/db/schema.ts` -- Agent table schema showing `cronSchedule.notNull()` and `executionHistory.agentId` with `onDelete: "set null"`
- `src/routes/agents.ts` -- REST API create/delete patterns for reference
- `src/services/scheduler.ts` -- `scheduleAgent()` and `removeAgent()` APIs
- `tests/telegram-commands.test.ts` -- Existing test patterns (mock structure, helpers)
- `tests/intent-parser.test.ts` -- Existing test patterns (mock generateText)

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions from `/gsd:discuss-phase` session

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new dependencies, all libraries already in use and verified in source
- Architecture: HIGH -- Direct extension of existing patterns, all code paths inspected
- Pitfalls: HIGH -- Identified from actual source code analysis (NOT NULL constraint, onDelete behavior, handler flow order)

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable codebase, no external API changes expected)
