# Phase 16: Telegram NLP Control - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn Telegram from a one-way notification channel into a two-way control interface. Users send natural language messages to the Telegram bot (e.g., "run my morning briefing", "disable the PR reminder", "list agents") and the bot interprets intent via LLM, executes the corresponding management operation, and replies with a concise confirmation. Schedule changes use the existing NL-to-cron parser from Phase 7.

</domain>

<decisions>
## Implementation Decisions

### Command scope
- Full management operations: list agents, run agent by name, enable/disable agents, check status/health
- Schedule changes supported via NL-to-cron parser (e.g., "change morning briefing to 8am")
- No create/delete agents via Telegram (use MCP/API for destructive ops)
- /help and /start commands for discoverability (standard Telegram bot convention)
- When user triggers "run X", bot replies with confirmation ("Running X...") and result comes through the existing notification flow — no inline result delivery

### Input parsing
- LLM-based intent detection for all messages (except /help, /start)
- /help and /start intercepted before LLM call — zero latency, no token cost
- LLM receives full agent list in prompt for semantic name resolution (e.g., "briefing" resolves to "Morning Briefing Agent")
- LLM picks best match — no ambiguity confirmation round-trips
- Unrecognized input gets friendly fallback: "I didn't understand that. Here's what I can do: [capabilities]"

### Security model
- Chat ID restriction only (reuse existing TELEGRAM_CHAT_ID env var from Phase 15)
- No confirmation needed for any operation — personal tool, if you said it you meant it
- Messages from unauthorized chat IDs silently ignored — no response, no information leakage

### Response format
- Concise confirmations: "Running Morning Briefing..." / "Disabled PR Reminder." / "Agents: 1. Morning Briefing (enabled) 2. PR Reminder (disabled)"
- Agent list shows name + status only (enabled/disabled, healthy/unhealthy)
- Error messages include brief guidance: "Agent 'foo' not found. Try: list agents"
- Minimal emojis for status: enabled, disabled, error — matches Phase 15 notification style

### Claude's Discretion
- Exact LLM prompt structure for intent detection
- Structured output schema for intent extraction (action + params)
- Telegram Bot API webhook vs polling implementation
- How to handle concurrent messages
- Typing indicator behavior

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Telegram integration
- `src/services/telegram.ts` — sendTelegramMessage utility, MarkdownV2 escaping functions
- `src/services/notifier.ts` — Existing Telegram notification builders (buildTelegramMarkdown, sendViaTelegram pattern)
- `src/mcp/tools/telegram.ts` — test_telegram MCP tool pattern

### NLP schedule parsing
- `src/services/schedule-parser.ts` — parseSchedule function with LLM-based NL-to-cron translation, croner validation
- `src/helpers/cron-detect.ts` — isCronExpression fast-path detection
- `src/schemas/schedule-input.ts` — Schedule parse schemas

### Agent management
- `src/routes/agents.ts` — REST API routes for agent CRUD (pattern reference)
- `src/mcp/tools/agents.ts` — MCP agent management tools (direct DB access pattern)
- `src/helpers/enrich-agent.ts` — enrichAgent helper for consistent agent response shape
- `src/services/executor.ts` — executeAgent function for triggering runs

### Configuration
- `src/config/env.ts` — TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID env vars already defined
- `src/config/llm-provider.ts` — resolveModel, DEFAULT_MODEL for LLM calls

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sendTelegramMessage(botToken, chatId, text)` — Direct Telegram Bot API call, already handles MarkdownV2 parse mode
- `escapeMdV2()` / `escapeMdV2CodeBlock()` — MarkdownV2 escaping for safe message formatting
- `parseSchedule(input)` — Full NL-to-cron pipeline with validation and human-readable output
- `enrichAgent(db, agent)` — Adds healthy, consecutiveFailures, nextRunAt, lastRunAt to agent objects
- `executeAgent(db, agent)` — Full execution pipeline with semaphore, circuit breaker, notifications

### Established Patterns
- Telegram messages use MarkdownV2 with `link_preview_options: { is_disabled: true }`
- LLM calls use Vercel AI SDK `generateText` with `Output.object({ schema })` for structured output
- Schedule parsing uses single retry with error feedback on NoObjectGeneratedError
- Circuit breaker wraps LLM calls, CircuitBreakerOpenError for specific error handling

### Integration Points
- TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID already in env config
- Bot needs a new entry point for receiving messages (webhook endpoint or polling loop)
- Agent queries go directly against DB (like MCP pattern, not through HTTP API)
- LLM provider setup reusable from schedule-parser.ts pattern

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 16-telegram-nlp-control*
*Context gathered: 2026-03-16*
