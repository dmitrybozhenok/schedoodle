# Requirements: Schedoodle

**Defined:** 2026-03-14
**Core Value:** Agents run reliably on schedule, process tasks through an LLM, and deliver structured results — without manual intervention.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Agent Management

- [x] **AGNT-01**: User can create an agent with a name, task description, and cron schedule via API
- [x] **AGNT-02**: User can read, update, and delete agents via API
- [x] **AGNT-03**: Each agent can have an optional system prompt that shapes its behavior and tone
- [x] **AGNT-04**: Agent definitions are persisted in the database

### LLM Execution

- [x] **EXEC-01**: Agent executes its task by sending the task description to an LLM and receiving a structured response
- [x] **EXEC-02**: LLM responses are validated against Zod schemas and returned as typed, structured output
- [x] **EXEC-03**: A single agent failure never crashes the service or blocks other agents from running
- [x] **EXEC-04**: Agents can fetch data from external URLs/APIs before the LLM call, passing fetched data as context

### Scheduling

- [x] **SCHD-01**: Agents run automatically according to their cron schedule
- [x] **SCHD-02**: Multiple agents can be scheduled concurrently without conflicts

### Resilience

- [x] **RSLN-01**: A circuit breaker per LLM provider prevents hammering a downed API
- [x] **RSLN-02**: Circuit breaker auto-recovers when the provider comes back online

### Notification

- [x] **NOTF-01**: Agent results are delivered via email after each successful execution
- [x] **NOTF-02**: Emails include the agent name, execution timestamp, and formatted results

### Observability

- [x] **OBSV-01**: Token usage and estimated cost are tracked per agent per execution
- [x] **OBSV-02**: A health check endpoint reports service status and basic operational info

### Natural Language Schedule Parsing

- [x] **NLP-01**: Natural language input like "every weekday at 9am" is translated to a valid cron expression
- [x] **NLP-02**: If input is already a valid cron expression, it is detected and described without an LLM call
- [x] **NLP-03**: Response includes a human-readable description of the cron expression via cronstrue
- [x] **NLP-04**: Ambiguous input returns a low-confidence warning so users can verify
- [x] **NLP-05**: Unparseable input returns a 422 with guidance and example suggestions
- [x] **NLP-06**: POST /schedules/parse endpoint accepts natural language and returns structured parse result
- [x] **NLP-07**: LLM unavailability (circuit breaker open) returns a 503 with fallback guidance to use raw cron

### Enhanced Health Monitoring

- [x] **HLTH-01**: Execution history records retryCount (number of LLM validation retries per execution)
- [x] **HLTH-02**: Each agent has a healthy boolean flag computed from consecutive failure count
- [x] **HLTH-03**: An agent with 3 consecutive failures is flagged unhealthy; auto-recovers on next success
- [x] **HLTH-04**: Health endpoint includes per-agent breakdown with lastRunAt, lastStatus, successRate, avgDurationMs, healthy, consecutiveFailures
- [x] **HLTH-05**: Health endpoint includes next 5 upcoming scheduled runs across all agents
- [x] **HLTH-06**: Agent API responses (GET /agents, GET /agents/:id) include healthy and consecutiveFailures via enrichAgent
- [x] **HLTH-07**: GET /agents/:id/executions defaults to 100 results (max 200)
- [x] **HLTH-08**: Health endpoint top-level status reflects system health: ok / degraded / unhealthy
- [x] **HLTH-09**: Scheduler exposes its job registry for external consumers (upcoming runs)
- [x] **HLTH-10**: Health endpoint includes system-wide successRate and avgDurationMs aggregates (24h window)

### Agent Tool Use

- [x] **TOOL-01**: web_fetch built-in tool fetches URL content and returns plain text (HTML converted via html-to-text)
- [x] **TOOL-02**: web_search built-in tool queries Brave Search API and returns structured results
- [x] **TOOL-03**: Custom webhook tools execute HTTP calls with configurable URL, method, headers, and JSON Schema input
- [x] **TOOL-04**: Full CRUD API at /tools for custom tool definitions (POST, GET, PATCH, DELETE)
- [x] **TOOL-05**: Many-to-many agent-tool attachment via join table with link/unlink API endpoints
- [x] **TOOL-06**: Executor uses generateText with tools + stopWhen: stepCountIs(10) for multi-step tool calling
- [x] **TOOL-07**: Tool call details logged as JSON array in execution history (toolName, input, output, durationMs)
- [x] **TOOL-08**: Per-agent configurable execution timeout via maxExecutionMs column + AbortController
- [x] **TOOL-09**: Database schema: tools table, agent_tools join table, maxExecutionMs on agents, toolCalls on executionHistory
- [x] **TOOL-10**: Built-in tools (web_fetch, web_search) automatically available to all agents without per-agent opt-in
- [x] **TOOL-11**: Circuit breaker wraps entire generateText call including all tool steps

### API Security and Hardening

- [x] **SEC-01**: Auth middleware blocks requests without valid Bearer token when AUTH_TOKEN env var is set
- [x] **SEC-02**: Auth middleware passes through all requests when AUTH_TOKEN is not configured (backward-compatible)
- [x] **SEC-03**: SSRF check blocks private/internal IP ranges (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, ::1, localhost) before URL prefetch
- [x] **SEC-04**: URL prefetch aborts and returns truncation message when response body exceeds 1 MB
- [x] **SEC-05**: Input field limits enforce max lengths via Zod (taskDescription: 10k, systemPrompt: 5k, model: 100)
- [x] **SEC-06**: In-memory per-IP rate limiter returns 429 after threshold (10/min LLM endpoints, 60/min general)
- [x] **SEC-07**: All responses include security headers: X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: same-origin
- [x] **SEC-08**: CORS blocks cross-origin requests (no permissive Access-Control-Allow-Origin)

### CI/CD Pipeline

- [x] **CI-01**: GitHub Actions workflow runs lint, typecheck, test, and build on every push to master
- [x] **CI-02**: All four checks run as parallel jobs for fastest feedback
- [x] **CI-03**: pnpm store is cached between runs for faster dependency installs
- [x] **CI-04**: Workflow supports manual dispatch via workflow_dispatch trigger
- [x] **CI-05**: Tests run with mocked environment variables (dummy ANTHROPIC_API_KEY)

### MCP Server

- [x] **MCP-01**: MCP server runs as a separate stdio process at src/mcp.ts with @modelcontextprotocol/sdk
- [x] **MCP-02**: list_agents MCP tool returns all agents with enriched data (health, schedule, enabled status)
- [x] **MCP-03**: get_agent MCP tool returns a single enriched agent by ID
- [x] **MCP-04**: create_agent MCP tool accepts natural language schedules and inserts agent into DB
- [x] **MCP-05**: update_agent MCP tool modifies agent fields with NL schedule resolution
- [x] **MCP-06**: delete_agent MCP tool uses two-step confirmation (preview then confirm)
- [x] **MCP-07**: execute_agent MCP tool triggers synchronous agent execution and returns full result
- [x] **MCP-08**: get_execution_history MCP tool returns execution records for an agent (default 100, max 200)
- [x] **MCP-09**: All MCP error responses include actionable guidance for self-correction
- [x] **MCP-10**: list_tools, get_tool, create_tool, update_tool MCP tools provide full custom tool CRUD
- [x] **MCP-11**: delete_tool MCP tool uses two-step confirmation matching delete_agent pattern
- [x] **MCP-12**: list_agent_tools MCP tool returns tools attached to an agent
- [x] **MCP-13**: attach_tool MCP tool links a custom tool to an agent
- [x] **MCP-14**: detach_tool MCP tool unlinks a custom tool from an agent
- [x] **MCP-15**: get_health MCP tool returns system health with per-agent breakdown and circuit breaker status
- [x] **MCP-16**: parse_schedule MCP tool converts natural language to cron expression
- [x] **MCP-17**: All 17 MCP tools are registered and discoverable via MCP tool listing

### Telegram Notification Channel

- [x] **TGRAM-01**: Telegram Bot API sendMessage sends notifications via direct fetch (no third-party library)
- [x] **TGRAM-02**: MarkdownV2 escape function handles all 18 special characters, with separate code block escaping
- [x] **TGRAM-03**: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID optional env vars control Telegram configuration
- [x] **TGRAM-04**: telegramDeliveryStatus column tracks Telegram delivery independently from email
- [x] **TGRAM-05**: Telegram messages use MarkdownV2 with bold agent name, timestamp, summary, details sections
- [x] **TGRAM-06**: Telegram messages truncated at ~3800 chars with truncation notice
- [x] **TGRAM-07**: Failure messages use warning emoji prefix and "FAILED:" header
- [x] **TGRAM-08**: Both email and Telegram dispatch in parallel via Promise.allSettled after each execution
- [x] **TGRAM-09**: Per-channel delivery status tracked independently (emailDeliveryStatus, telegramDeliveryStatus)
- [x] **TGRAM-10**: test_telegram MCP tool sends test message to verify bot configuration
- [x] **TGRAM-11**: Health endpoint includes per-channel delivery stats (email and Telegram sent/failed counts)
- [x] **TGRAM-12**: Telegram silently skipped when either env var is missing (matches email skip pattern)

### Telegram NLP Control

- [x] **TGCTL-01**: Telegram bot receives incoming messages via polling (getUpdates) and routes to command handler
- [x] **TGCTL-02**: /start and /help commands handled directly without LLM call, returning bot capabilities
- [x] **TGCTL-03**: Free-text messages parsed by LLM to extract intent (list, run, enable, disable, status, reschedule) and target agent name
- [x] **TGCTL-04**: LLM resolves fuzzy agent names from full agent list (e.g., "briefing" matches "Morning Briefing Agent")
- [x] **TGCTL-05**: "Run X" triggers executeAgent and replies with concise confirmation; result via existing notification flow
- [x] **TGCTL-06**: "List agents" returns agent names with enabled/disabled and healthy/unhealthy status indicators
- [x] **TGCTL-07**: "Enable/disable X" toggles agent enabled flag and updates scheduler
- [x] **TGCTL-08**: "Change X to [NL schedule]" updates agent schedule using Phase 7 NL-to-cron parser
- [x] **TGCTL-09**: "Status" or "health" returns concise system health summary
- [x] **TGCTL-10**: Only messages from configured TELEGRAM_CHAT_ID processed; unauthorized messages silently ignored
- [x] **TGCTL-11**: Unrecognized input gets friendly fallback with help text listing available capabilities
- [x] **TGCTL-12**: Error messages include brief guidance (e.g., "Agent 'foo' not found. Try: list agents")

### Telegram Agent Lifecycle Management

- [x] **TGSCHED-01**: Intent schema extended with 4 new actions (create, delete, update_task, rename) and 2 new fields (taskDescription, newName)
- [x] **TGSCHED-02**: LLM intent parser prompt includes extraction rules and disambiguation for all new actions
- [x] **TGSCHED-03**: "Create [name] that [task] every [schedule]" creates a new agent via Telegram with name, task, and optional schedule
- [x] **TGSCHED-04**: Agent created without schedule is disabled (enabled=0) with empty cronSchedule
- [x] **TGSCHED-05**: Agent created with schedule is auto-enabled and immediately registered with scheduler
- [x] **TGSCHED-06**: Duplicate name on create rejected with guidance ("already exists, use update instead")
- [x] **TGSCHED-07**: "Delete [agent]" triggers confirmation prompt with 60-second time-limited pending state
- [x] **TGSCHED-08**: "yes"/"confirm" (case-insensitive) within 60s executes deletion; "no"/"cancel" cancels
- [x] **TGSCHED-09**: Any other message after delete request clears pending deletion and processes normally
- [x] **TGSCHED-10**: "Update [agent] task to [description]" modifies agent taskDescription
- [x] **TGSCHED-11**: "Rename [agent] to [new name]" changes agent name with duplicate check
- [x] **TGSCHED-12**: Help text (/help, /start) lists all new capabilities: create, delete, update task, rename
- [x] **TGSCHED-13**: Pending deletion timer uses unref() to prevent blocking graceful shutdown

### Eval Suite Expansion

- [ ] **EVAL-01**: tool-usage.jsonl has 3 cases testing computation on fetched data, anti-hallucination, and multi-source synthesis (distinct from web-fetch.jsonl)
- [ ] **EVAL-02**: temporal-reasoning.jsonl has 3 cases covering cron expression explanation, date math, and time zone conversion with DST
- [ ] **EVAL-03**: output-format.jsonl has 3 cases testing JSON, Markdown table, and CSV structural validity
- [ ] **EVAL-04**: safety.jsonl has 3 cases testing prompt injection resistance (ignore instructions, system prompt leak, jailbreak)
- [ ] **EVAL-05**: code-generation.jsonl has 3 cases testing function writing, bug finding, and code refactoring

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Agent Management

- **AGNT-05**: User can enable/disable an agent without deleting it
- **AGNT-06**: Agent creation validates cron expressions and required fields at create time

### LLM Execution

- **EXEC-05**: User can trigger any agent manually via API without waiting for schedule
- **EXEC-06**: Each agent can define its own Zod output schema for typed results
- **EXEC-07**: Dry-run mode validates data fetching and schema without calling LLM or sending email

### Scheduling

- **SCHD-03**: Missed runs are detected and executed when the service restarts (catch-up on startup)
- **SCHD-04**: Cron schedules are interpreted in the user's timezone, including DST transitions

### Resilience

- **RSLN-03**: Failed LLM calls are retried with exponential backoff and jitter (configurable max retries)

### Notification

- **NOTF-03**: Different agents can use different email templates matched to their output format

### Observability

- **OBSV-03**: Full execution history is stored and queryable (status, timestamp, duration, result, error)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web dashboard / UI | API-first for v1; curl + future CLI cover the use case |
| ~~Multi-user / authentication~~ | ~~Personal tool; run on localhost or behind VPN~~ -- Single-token auth added in Phase 10 |
| Agent chaining / workflows | Independent agents only; workflow orchestration is an entire product category |
| Real-time streaming | Agents are batch jobs; streaming adds complexity for zero value |
| ~~Multiple notification channels~~ | ~~Email only; design notifier as pluggable for future channels~~ -- Telegram added in Phase 15 |
| ~~LLM tool-use / function-calling loops~~ | ~~Pre-fetch pattern is cheaper, more reliable, and deterministic~~ -- Implemented in Phase 9 |
| Plugin / extension system | Premature abstraction; extract extension points after patterns emerge |
| ~~Natural language schedule input~~ | ~~Use cron expressions; link to crontab.guru in docs~~ -- Implemented in Phase 7 |
| Agent marketplace / sharing | No users to share with; copy-paste JSON configs instead |
| Shell command / code execution tool | Security implications need separate design |
| Per-agent tool opt-out for built-ins | All agents get built-ins for now |
| Tool authentication beyond static headers | OAuth, dynamic tokens deferred |
| MCP HTTP/SSE transport | stdio sufficient for local Claude Code use |
| MCP Resources/Prompts primitives | Tools-only approach validated first |
| MCP scheduler integration | Avoid dual-process cron conflicts |
| Per-agent notification channel selection | Both channels fire globally; per-agent config deferred |
| Notification channel abstraction | No interface pattern until a third channel is added |
| System prompt editing via Telegram | Too complex for chat interface, keep in API/MCP |
| Step-by-step conversational agent creation | Single-message approach sufficient for now |
| Agent cloning via Telegram | Nice-to-have, separate phase |
| Batch operations via Telegram | Separate phase |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AGNT-01 | Phase 3 | Complete |
| AGNT-02 | Phase 3 | Complete |
| AGNT-03 | Phase 3 | Complete |
| AGNT-04 | Phase 1 | Complete |
| EXEC-01 | Phase 2 | Complete |
| EXEC-02 | Phase 2 | Complete |
| EXEC-03 | Phase 2 | Complete |
| EXEC-04 | Phase 2 | Complete |
| SCHD-01 | Phase 3 | Complete |
| SCHD-02 | Phase 3 | Complete |
| RSLN-01 | Phase 4 | Complete |
| RSLN-02 | Phase 4 | Complete |
| NOTF-01 | Phase 5 | Complete |
| NOTF-02 | Phase 5 | Complete |
| OBSV-01 | Phase 4 | Complete |
| OBSV-02 | Phase 4 | Complete |
| NLP-01 | Phase 7 | Complete |
| NLP-02 | Phase 7 | Complete |
| NLP-03 | Phase 7 | Complete |
| NLP-04 | Phase 7 | Complete |
| NLP-05 | Phase 7 | Complete |
| NLP-06 | Phase 7 | Complete |
| NLP-07 | Phase 7 | Complete |
| HLTH-01 | Phase 8 | Complete |
| HLTH-02 | Phase 8 | Complete |
| HLTH-03 | Phase 8 | Complete |
| HLTH-04 | Phase 8 | Complete |
| HLTH-05 | Phase 8 | Complete |
| HLTH-06 | Phase 8 | Complete |
| HLTH-07 | Phase 8 | Complete |
| HLTH-08 | Phase 8 | Complete |
| HLTH-09 | Phase 8 | Complete |
| HLTH-10 | Phase 8 | Complete |
| TOOL-01 | Phase 9 | Planned |
| TOOL-02 | Phase 9 | Planned |
| TOOL-03 | Phase 9 | Planned |
| TOOL-04 | Phase 9 | Planned |
| TOOL-05 | Phase 9 | Planned |
| TOOL-06 | Phase 9 | Planned |
| TOOL-07 | Phase 9 | Planned |
| TOOL-08 | Phase 9 | Planned |
| TOOL-09 | Phase 9 | Planned |
| TOOL-10 | Phase 9 | Planned |
| TOOL-11 | Phase 9 | Planned |
| SEC-01 | Phase 10 | Planned |
| SEC-02 | Phase 10 | Planned |
| SEC-03 | Phase 10 | Planned |
| SEC-04 | Phase 10 | Planned |
| SEC-05 | Phase 10 | Planned |
| SEC-06 | Phase 10 | Planned |
| SEC-07 | Phase 10 | Planned |
| SEC-08 | Phase 10 | Planned |
| CI-01 | Phase 13 | Complete |
| CI-02 | Phase 13 | Complete |
| CI-03 | Phase 13 | Complete |
| CI-04 | Phase 13 | Complete |
| CI-05 | Phase 13 | Complete |
| MCP-01 | Phase 14 | Planned |
| MCP-02 | Phase 14 | Planned |
| MCP-03 | Phase 14 | Planned |
| MCP-04 | Phase 14 | Planned |
| MCP-05 | Phase 14 | Planned |
| MCP-06 | Phase 14 | Planned |
| MCP-07 | Phase 14 | Planned |
| MCP-08 | Phase 14 | Planned |
| MCP-09 | Phase 14 | Planned |
| MCP-10 | Phase 14 | Planned |
| MCP-11 | Phase 14 | Planned |
| MCP-12 | Phase 14 | Planned |
| MCP-13 | Phase 14 | Planned |
| MCP-14 | Phase 14 | Planned |
| MCP-15 | Phase 14 | Planned |
| MCP-16 | Phase 14 | Planned |
| MCP-17 | Phase 14 | Planned |
| TGRAM-01 | Phase 15 | Planned |
| TGRAM-02 | Phase 15 | Planned |
| TGRAM-03 | Phase 15 | Planned |
| TGRAM-04 | Phase 15 | Planned |
| TGRAM-05 | Phase 15 | Planned |
| TGRAM-06 | Phase 15 | Planned |
| TGRAM-07 | Phase 15 | Planned |
| TGRAM-08 | Phase 15 | Planned |
| TGRAM-09 | Phase 15 | Planned |
| TGRAM-10 | Phase 15 | Planned |
| TGRAM-11 | Phase 15 | Planned |
| TGRAM-12 | Phase 15 | Planned |
| TGCTL-01 | Phase 16 | Planned |
| TGCTL-02 | Phase 16 | Planned |
| TGCTL-03 | Phase 16 | Planned |
| TGCTL-04 | Phase 16 | Planned |
| TGCTL-05 | Phase 16 | Planned |
| TGCTL-06 | Phase 16 | Planned |
| TGCTL-07 | Phase 16 | Planned |
| TGCTL-08 | Phase 16 | Planned |
| TGCTL-09 | Phase 16 | Planned |
| TGCTL-10 | Phase 16 | Planned |
| TGCTL-11 | Phase 16 | Planned |
| TGCTL-12 | Phase 16 | Planned |
| TGSCHED-01 | Phase 18 | Planned |
| TGSCHED-02 | Phase 18 | Planned |
| TGSCHED-03 | Phase 18 | Planned |
| TGSCHED-04 | Phase 18 | Planned |
| TGSCHED-05 | Phase 18 | Planned |
| TGSCHED-06 | Phase 18 | Planned |
| TGSCHED-07 | Phase 18 | Planned |
| TGSCHED-08 | Phase 18 | Planned |
| TGSCHED-09 | Phase 18 | Planned |
| TGSCHED-10 | Phase 18 | Planned |
| TGSCHED-11 | Phase 18 | Planned |
| TGSCHED-12 | Phase 18 | Planned |
| TGSCHED-13 | Phase 18 | Planned |
| EVAL-01 | Phase 19 | Planned |
| EVAL-02 | Phase 19 | Planned |
| EVAL-03 | Phase 19 | Planned |
| EVAL-04 | Phase 19 | Planned |
| EVAL-05 | Phase 19 | Planned |

**Coverage:**
- v1 requirements: 116 total
- Mapped to phases: 116
- Unmapped: 0

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-16 after Phase 19 planning*
