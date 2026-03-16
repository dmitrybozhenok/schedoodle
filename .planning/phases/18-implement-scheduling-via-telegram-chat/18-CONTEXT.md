# Phase 18: Implement Scheduling via Telegram Chat - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend the Telegram bot from Phase 16 to support full agent lifecycle management: create new agents, delete agents (with confirmation), edit task descriptions, and rename agents — all via natural language messages. The existing intent parser is extended with new actions and fields. Schedule changes (reschedule) remain as-is from Phase 16.

</domain>

<decisions>
## Implementation Decisions

### Agent creation flow
- Single-message creation: user sends one message like "create Morning Briefing that runs daily at 7am and summarizes my emails"
- LLM extracts name, task description, and optional schedule from the message
- Required fields: name and task description. If either is missing, reject with guidance and example
- Optional: schedule (if omitted, agent created as disabled with no cron job)
- No system prompt extraction — system prompt stays API/MCP-only
- If schedule is provided, agent is auto-enabled and immediately registered with the scheduler
- If no schedule, agent is created disabled (enabled=0)
- No conversation state for creation — reject with guidance if incomplete, user resends

### Agent deletion
- Delete supported via Telegram with a confirmation step
- "delete X" triggers a confirmation prompt: "Delete X? This removes the agent and all its execution history. Reply 'yes' to confirm."
- Time-limited pending state: in-memory Map<chatId, { agentId, agentName, expiresAt }>
- "yes"/"confirm" within 60 seconds executes the delete
- "no"/"cancel" clears the pending deletion
- Any other message clears the pending deletion and processes the new message normally
- 60-second timeout auto-clears the pending state
- Delete cascades to execution history (matches existing API DELETE behavior)
- Scheduler job removed on deletion

### Edit capabilities
- Task description editable: "update X task to ..." updates the agent's taskDescription
- Name editable: "rename X to Y" updates the agent's name
- System prompt NOT editable via Telegram — stays API/MCP-only
- Schedule changes already handled by Phase 16's reschedule command

### Intent parser extension
- Extend existing telegramIntentSchema with new actions: create, delete, update_task, rename
- Add new nullable fields: taskDescription, newName, cronSchedule (for create)
- Single parseIntent() call handles all actions (no separate parsers)
- LLM prompt updated with new action descriptions and extraction rules

### Response format
- Creation confirmation echoes: name, human-readable schedule, task description, enabled status
- Deletion confirmation shows what will be removed before user confirms
- Edit confirmations are concise: "Updated X task." / "Renamed to Y."
- Duplicate name on create: reject with guidance ("already exists, use update instead")
- Missing fields on create: reject with example message
- Error messages include actionable guidance (matches Phase 16 pattern)

### Help text
- Updated to include all new capabilities: create, delete, update task, rename
- Full command list with examples in /help and /start responses

### Claude's Discretion
- Exact LLM prompt wording for new action extraction
- How to structure the pending deletion cleanup (setTimeout vs check-on-access)
- Whether to add cronSchedule field or reuse scheduleInput for create's schedule extraction
- Test structure for new command handlers

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Telegram bot (Phase 16 implementation)
- `src/services/telegram-commands.ts` — Existing command handlers (list, run, enable, disable, status, reschedule, unknown)
- `src/services/intent-parser.ts` — LLM-based intent parsing with retry pattern
- `src/schemas/telegram-intent.ts` — Current intent schema (actions + nullable fields)
- `src/services/telegram-poller.ts` — Polling loop, sendPlainText, sendTypingAction utilities

### Agent management
- `src/db/schema.ts` — Agent table schema, execution history with CASCADE behavior
- `src/routes/agents.ts` — REST API agent CRUD (reference for create/delete patterns)
- `src/services/scheduler.ts` — scheduleAgent, removeAgent for cron job registration
- `src/helpers/enrich-agent.ts` — enrichAgent for consistent agent response shape

### Schedule parsing
- `src/services/schedule-parser.ts` — parseSchedule for NL-to-cron translation
- `src/helpers/cron-detect.ts` — isCronExpression for fast-path cron detection

### Configuration
- `src/config/env.ts` — TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID env vars
- `src/config/llm-provider.ts` — resolveModel, DEFAULT_MODEL for LLM calls

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `handleTelegramMessage()` in telegram-commands.ts — Main dispatcher to extend with new actions
- `parseIntent()` in intent-parser.ts — Single LLM call for intent extraction, extend schema and prompt
- `parseSchedule()` in schedule-parser.ts — NL-to-cron pipeline, reuse for create's optional schedule
- `findAgentByName()` in telegram-commands.ts — Case-insensitive agent lookup, reuse for all new commands
- `sendPlainText()` / `sendTypingAction()` — Telegram response utilities

### Established Patterns
- Intent parsing: single LLM call with Output.object({ schema }) and NoObjectGeneratedError retry
- Command handlers: pure functions taking (agentName, db) returning string responses
- Fire-and-forget execution: void executeAgent(...).catch(...) pattern
- DB operations: direct Drizzle queries (select/insert/update/delete) with .run() / .get() / .all()
- Scheduler sync: scheduleAgent(agent, db) after enable, removeAgent(id) after disable/delete

### Integration Points
- telegram-commands.ts switch statement dispatches on intent.action — add new cases
- telegramIntentSchema enum — add new action values
- intent-parser.ts system prompt — add new action descriptions
- HELP_TEXT constant — update with new capabilities
- Pending deletion state is new (in-memory Map) — needs cleanup on module unload/shutdown

</code_context>

<specifics>
## Specific Ideas

- Creation confirmation should echo all extracted fields so user can verify LLM interpreted correctly
- Deletion confirmation pattern matches MCP's two-step delete (Phase 14)
- Pending deletion map keyed by chatId (single user, but future-proof for multi-chat)
- "yes" confirmation should be case-insensitive

</specifics>

<deferred>
## Deferred Ideas

- System prompt editing via Telegram — too complex for chat interface, keep in API/MCP
- Step-by-step conversational agent creation — could be a future enhancement if single-message feels limiting
- Agent cloning via Telegram ("clone X as Y") — nice-to-have, separate phase
- Batch operations ("disable all agents", "delete all disabled") — separate phase

</deferred>

---

*Phase: 18-implement-scheduling-via-telegram-chat*
*Context gathered: 2026-03-16*
