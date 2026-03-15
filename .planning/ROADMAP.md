# Roadmap: Schedoodle

## Overview

Schedoodle delivers a personal AI agent automation platform in five phases. We start by laying the database schema and project foundation, then build the core LLM execution pipeline that proves agents can process tasks and return structured results. From there we add the management API and cron scheduling so agents run automatically, harden the system with circuit breakers and observability, and finally close the loop with email delivery of results.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation and Schema** - Project scaffold, database schema, agent persistence, and configuration validation
- [x] **Phase 2: Execution Engine** - Core LLM pipeline with structured output, data pre-fetch, and graceful failure handling (completed 2009-03-14)
- [x] **Phase 3: Management API and Scheduling** - Agent CRUD endpoints, system prompts, and cron-based automatic execution (completed 2009-03-14)
- [x] **Phase 4: Resilience and Observability** - Circuit breaker, token tracking, cost estimation, and health check endpoint (completed 2009-03-14)
- [ ] **Phase 5: Notification** - Email delivery of agent results via Resend

## Phase Details

### Phase 1: Foundation and Schema
**Goal**: Agent definitions can be created and persisted in a database with validated schemas
**Depends on**: Nothing (first phase)
**Requirements**: AGNT-04
**Success Criteria** (what must be TRUE):
  1. The project builds and runs with TypeScript, producing a working Node.js process
  2. Agent definitions (name, task description, cron schedule, system prompt) are stored in and retrieved from SQLite
  3. Environment configuration (LLM API keys, database path) is validated at startup with clear error messages on misconfiguration
  4. Database schema includes tables for agents and execution history with all observability fields (status, tokens, duration, delivery status)
**Plans:** 1 plan
Plans:
- [ ] 01-01-PLAN.md — Scaffold project, create DB schema with agents and execution_history tables, config validation, and integration tests

### Phase 2: Execution Engine
**Goal**: Agents can execute their tasks through an LLM and return validated, structured results
**Depends on**: Phase 1
**Requirements**: EXEC-01, EXEC-02, EXEC-03, EXEC-04
**Success Criteria** (what must be TRUE):
  1. An agent sends its task description to an LLM and receives a structured response validated against a Zod schema
  2. An agent can fetch data from external URLs before the LLM call, and that data is included as context in the prompt
  3. A failing agent (bad prompt, unreachable URL, LLM error) returns a structured error result without crashing the process
  4. Multiple agents can execute concurrently without interfering with each other
**Plans:** 2/2 plans complete
Plans:
- [ ] 02-01-PLAN.md — Install AI SDK deps, add model column, create output schema and URL pre-fetch service with tests
- [ ] 02-02-PLAN.md — Build core executor function with LLM call, validation retry, DB recording, and concurrent execution

### Phase 3: Management API and Scheduling
**Goal**: Users can manage agents via REST API and agents run automatically on their cron schedules
**Depends on**: Phase 2
**Requirements**: AGNT-01, AGNT-02, AGNT-03, SCHD-01, SCHD-02
**Success Criteria** (what must be TRUE):
  1. User can create an agent with name, task description, cron schedule, and optional system prompt via a POST endpoint
  2. User can list, read, update, and delete agents via REST API endpoints
  3. An agent with a cron schedule executes automatically at the scheduled time without manual intervention
  4. Multiple agents with different cron schedules run concurrently without conflicts or missed executions
  5. System prompt shapes the LLM's behavior and tone when the agent executes
**Plans:** 2/2 plans complete
Plans:
- [ ] 03-01-PLAN.md — Install deps, update env/schema, create input schemas and scheduler service with tests
- [ ] 03-02-PLAN.md — Build Hono CRUD routes, execution history endpoint, and wire index.ts with server + scheduler

### Phase 4: Resilience and Observability
**Goal**: The system handles LLM provider failures gracefully and provides visibility into execution costs and service health
**Depends on**: Phase 3
**Requirements**: RSLN-01, RSLN-02, OBSV-01, OBSV-02
**Success Criteria** (what must be TRUE):
  1. When an LLM provider is down, the circuit breaker trips and subsequent calls fail fast instead of timing out
  2. After the provider recovers, the circuit breaker automatically closes and agents resume normal execution
  3. Each execution records token usage (input/output) and estimated cost, queryable per agent
  4. A health check endpoint returns service status including uptime, number of registered agents, and recent execution summary
**Plans:** 2/2 plans complete
Plans:
- [ ] 04-01-PLAN.md — Circuit breaker service, pricing config, schema migration, executor integration with tests
- [ ] 04-02-PLAN.md — Health check endpoint with uptime, agent count, execution summary, and circuit breaker status

### Phase 5: Notification
**Goal**: Agent results are automatically delivered to the user's inbox after each execution
**Depends on**: Phase 4
**Requirements**: NOTF-01, NOTF-02
**Success Criteria** (what must be TRUE):
  1. After a successful agent execution, an email is sent containing the results without manual intervention
  2. The email includes the agent name, execution timestamp, and formatted results in a readable layout
  3. Email delivery failures do not cause the execution to be marked as failed (delivery is tracked independently)
**Plans:** 2 plans
Plans:
- [ ] 05-01-PLAN.md — Notifier service with Resend SDK, HTML email builder, env config, and unit tests
- [ ] 05-02-PLAN.md — Wire notifier into executor with deliveryStatus tracking and integration tests

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12 -> 13 -> 14 -> 15

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and Schema | 1/1 | Complete | 2009-03-14 |
| 2. Execution Engine | 2/2 | Complete   | 2009-03-14 |
| 3. Management API and Scheduling | 2/2 | Complete   | 2009-03-14 |
| 4. Resilience and Observability | 2/2 | Complete   | 2009-03-14 |
| 5. Notification | 2/2 | Complete   | 2009-03-14 |
| 6. Agent Enabled Flag and Schedule Controls | 2/2 | Complete   | 2009-03-14 |
| 7. Natural Language Schedule Parsing | 2/2 | Complete   | 2009-03-15 |
| 8. Enhanced Health Monitoring | 2/2 | Complete | 2026-03-15 |
| 9. Agent Tool Use | 1/3 | In Progress|  |
| 10. API Security and Hardening | 2/2 | Complete    | 2026-03-15 |
| 11. Data Integrity and Execution Lifecycle | 2/2 | Complete    | 2026-03-15 |
| 12. LLM Concurrency Limits and Graceful Shutdown | 2/2 | Complete    | 2026-03-15 |
| 13. CI/CD Pipeline | 1/1 | Complete    | 2026-03-15 |
| 14. MCP Server | 2/2 | Complete    | 2026-03-15 |
| 15. Telegram Notification Channel | 1/2 | In Progress|  |

### Phase 6: Agent Enabled Flag and Schedule Controls

**Goal:** Agents can be enabled/disabled without deletion, and API responses include computed schedule metadata (nextRunAt, lastRunAt)
**Requirements**: AGNT-05
**Depends on:** Phase 5
**Success Criteria** (what must be TRUE):
  1. User can disable an agent via PATCH, which immediately removes its cron job
  2. User can re-enable an agent via PATCH, which immediately registers its cron job
  3. Disabled agents can still be manually executed via POST /:id/execute
  4. All agent API responses include boolean enabled, nextRunAt (from croner), and lastRunAt (from execution history)
  5. GET /agents supports ?enabled=true/false query param filtering
  6. At startup, only enabled agents are loaded into the scheduler
**Plans:** 2 plans
Plans:
- [x] 06-01-PLAN.md — Schema enabled column, input schemas, enrichAgent helper, scheduler enable/disable logic, and tests
- [x] 06-02-PLAN.md — API routes with enabled toggle, filtering, enriched responses, startup filtering, and route tests

### Phase 7: Natural Language Schedule Parsing

**Goal:** Users can describe when they want an agent to run in plain English, and the system translates it to a cron expression with a human-readable confirmation before saving
**Requirements**: NLP-01, NLP-02, NLP-03, NLP-04, NLP-05, NLP-06, NLP-07
**Depends on:** Phase 6
**Success Criteria** (what must be TRUE):
  1. Natural language input like "every weekday at 9am" is translated to a valid cron expression
  2. The response includes both the cron expression and a human-readable description (e.g., "At 09:00, Monday through Friday")
  3. If input is already a valid cron expression, it is detected and described without an LLM call
  4. Ambiguous input returns a low-confidence warning so users can verify
  5. Unparseable input returns a 422 with guidance and example suggestions
  6. LLM unavailability returns a 503 with fallback guidance to use raw cron
**Plans:** 2 plans
Plans:
- [x] 07-01-PLAN.md — Cron detection helper, schedule parse schemas, NL-to-cron parser service with LLM + cronstrue, and unit tests
- [x] 07-02-PLAN.md — POST /schedules/parse route, wire into index.ts, and route-level tests

### Phase 8: Enhanced Health Monitoring

**Goal:** The system provides per-agent health visibility with unhealthy detection, execution diagnostics (retryCount), aggregate statistics, and upcoming scheduled runs through an enhanced /health endpoint
**Requirements**: HLTH-01, HLTH-02, HLTH-03, HLTH-04, HLTH-05, HLTH-06, HLTH-07, HLTH-08, HLTH-09, HLTH-10
**Depends on:** Phase 7
**Success Criteria** (what must be TRUE):
  1. Each execution records the number of LLM validation retries (retryCount) in the database
  2. Agents are flagged unhealthy after 3 consecutive failures and auto-recover on next success
  3. Health endpoint returns per-agent breakdown with lastRunAt, lastStatus, successRate, avgDurationMs, healthy, consecutiveFailures
  4. Health endpoint returns next 5 upcoming scheduled runs across all agents
  5. Health endpoint top-level status reflects system health: ok / degraded / unhealthy
  6. Agent API responses include healthy and consecutiveFailures via enrichAgent
  7. GET /agents/:id/executions defaults to 100 results (max 200)
  8. Health endpoint includes system-wide successRate and avgDurationMs aggregates (24h window)
**Plans:** 2 plans
Plans:
- [x] 08-01-PLAN.md — Schema retryCount, executor tracking, scheduler getScheduledJobs, enrichAgent healthy flag, agents route limit, and tests
- [x] 08-02-PLAN.md — Enhanced /health endpoint with per-agent breakdown, aggregates, upcoming runs, status levels, and tests

### Phase 9: Agent Tool Use with Built-in and Custom Tools

**Goal:** Agents can use tools (functions) during LLM execution, with two built-in tools (web_fetch, web_search) available to all agents plus user-defined custom webhook tools attached via a many-to-many relationship
**Requirements**: TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05, TOOL-06, TOOL-07, TOOL-08, TOOL-09, TOOL-10, TOOL-11
**Depends on:** Phase 8
**Success Criteria** (what must be TRUE):
  1. Agents can use a web_fetch tool to retrieve URL content during LLM execution
  2. Agents can use a web_search tool to query Brave Search during LLM execution
  3. Users can define custom webhook tools with URL, method, headers, and JSON Schema input via CRUD API
  4. Users can attach/detach custom tools to/from agents via API
  5. The executor uses AI SDK generateText with tools and stepCountIs(10) for multi-step tool calling
  6. Tool call details (toolName, input, output, durationMs) are logged in execution history
  7. Per-agent execution timeout is configurable via maxExecutionMs and enforced with AbortController
  8. Circuit breaker wraps the entire multi-step generateText call
  9. Built-in tools are automatically available to all agents without opt-in
**Plans:** 1/3 plans executed
Plans:
- [ ] 09-01-PLAN.md — Schema (tools table, agent_tools join, maxExecutionMs, toolCalls), env config, built-in tools, webhook factory, tool registry, and tests
- [ ] 09-02-PLAN.md — Executor modifications: tools + stopWhen + AbortController timeout + tool call logging, and tests
- [ ] 09-03-PLAN.md — Tools CRUD API, agent-tool attachment endpoints, mount routes, and tests

### Phase 10: API Security and Hardening

**Goal:** All API endpoints are protected with bearer token authentication, URL prefetch is hardened against SSRF and memory abuse, input fields have length constraints, LLM-invoking endpoints are rate-limited, and all responses include security headers with CORS restricted to same-origin
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, SEC-08
**Depends on:** Phase 9
**Success Criteria** (what must be TRUE):
  1. When AUTH_TOKEN env var is set, requests without a valid Bearer token are rejected with 401
  2. When AUTH_TOKEN is not configured, all requests pass through (backward-compatible)
  3. URLs pointing to private/internal IP ranges are blocked before fetch (SSRF protection)
  4. URL prefetch aborts and returns truncation message when response exceeds 1 MB
  5. Agent input fields enforce max lengths (taskDescription: 10k, systemPrompt: 5k, model: 100)
  6. LLM-invoking endpoints return 429 after 10 requests/minute per IP; general endpoints after 60/minute
  7. All responses include X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: same-origin
  8. Cross-origin requests are blocked (no permissive Access-Control-Allow-Origin)
**Plans:** 2/2 plans complete
Plans:
- [ ] 10-01-PLAN.md — Auth middleware, security headers, CORS, rate limiter, env config, and mount all middleware in index.ts
- [ ] 10-02-PLAN.md — SSRF protection, response size limit in prefetch, and input field max length constraints

### Phase 11: Data Integrity and Execution Lifecycle

**Goal:** Execution history has performance indexes, stale running records are cleaned up on startup, old history is pruned by configurable retention, and disabled agents are blocked from manual execution
**Requirements**: EXEC-05, INDEX-01, STARTUP-01, STARTUP-02, ENV-01, EXEC-05-guard
**Depends on:** Phase 10
**Success Criteria** (what must be TRUE):
  1. execution_history table has indexes on agent_id, (agent_id, started_at), and status for query performance
  2. On startup, all 'running' execution records are marked as 'failure' with error message
  3. On startup, execution records older than RETENTION_DAYS (default 30) are deleted
  4. RETENTION_DAYS is configurable via env var with sensible default and minimum
  5. Startup tasks run before the scheduler starts
  6. Disabled agents return 409 from POST /agents/:id/execute
**Plans:** 2/2 plans complete
Plans:
- [ ] 11-01-PLAN.md — Schema indexes, RETENTION_DAYS env, startup module (stale cleanup + pruning), boot sequence wiring, and tests
- [ ] 11-02-PLAN.md — 409 guard on disabled agent manual execute endpoint and test updates

### Phase 12: LLM Concurrency Limits and Graceful Shutdown

**Goal:** Concurrent LLM executions are bounded by a configurable semaphore, the shutdown process drains in-flight executions with a timeout, and the health endpoint provides concurrency visibility
**Requirements**: CONC-01, CONC-02, CONC-03, SHUT-01, SHUT-02, SHUT-03, OBSV-01, OBSV-02, OBSV-03
**Depends on:** Phase 11
**Success Criteria** (what must be TRUE):
  1. A counting semaphore limits concurrent LLM calls to MAX_CONCURRENT_LLM (default 3)
  2. Both cron-triggered and manual executions share the same concurrency pool via semaphore-wrapped executeAgent
  3. Excess executions wait in FIFO order until a slot frees up
  4. On SIGINT/SIGTERM, the service stops accepting new work and waits up to 30s for in-flight executions
  5. If timeout expires, remaining 'running' records are marked as 'failure' with 'Shutdown timeout exceeded'
  6. Queued (not-yet-started) executions are dropped on shutdown
  7. Health endpoint includes concurrency stats (active, queued, limit) and shutting_down flag
  8. Health endpoint returns 503 during shutdown
  9. Log emitted only when an execution has to wait for a slot
**Plans:** 2/2 plans complete
Plans:
- [ ] 12-01-PLAN.md — Semaphore module, MAX_CONCURRENT_LLM env config, executor semaphore wrapping, and tests
- [ ] 12-02-PLAN.md — Graceful shutdown drain/timeout, health concurrency stats, shutdown guards, and tests

### Phase 13: CI/CD Pipeline

**Goal:** Automated CI pipeline runs lint, typecheck, test, and build checks on every push to master and on manual dispatch via GitHub Actions
**Requirements**: CI-01, CI-02, CI-03, CI-04, CI-05
**Depends on:** Phase 12
**Success Criteria** (what must be TRUE):
  1. Pushing to master triggers a GitHub Actions workflow with four checks: lint, typecheck, test, build
  2. All four checks run as parallel jobs for fastest feedback
  3. pnpm store is cached between runs for faster installs
  4. Workflow can be manually triggered via workflow_dispatch
  5. Tests run with mocked external services (dummy ANTHROPIC_API_KEY in workflow env)
**Plans:** 1/1 plans complete
Plans:
- [x] 13-01-PLAN.md — GitHub Actions CI workflow with four parallel jobs (lint, typecheck, test, build), pnpm caching, and typecheck script

### Phase 14: MCP Server for Claude Code Integration

**Goal:** Schedoodle's full management capabilities are exposed through an MCP server with stdio transport, enabling Claude Code to manage agents, trigger executions, check health, and manage tools directly from the CLI
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06, MCP-07, MCP-08, MCP-09, MCP-10, MCP-11, MCP-12, MCP-13, MCP-14, MCP-15, MCP-16, MCP-17
**Depends on:** Phase 13
**Success Criteria** (what must be TRUE):
  1. MCP server runs as a separate stdio process at src/mcp.ts using @modelcontextprotocol/sdk
  2. All 17 MCP tools are registered and discoverable (agent CRUD, execute, history, tool CRUD, agent-tool linking, health, schedule parsing)
  3. Agent management tools support natural language schedule input via the schedule-parser service
  4. Destructive operations (delete_agent, delete_tool) require two-step confirmation (preview then confirm)
  5. All error responses include actionable guidance for Claude to self-correct
  6. The MCP server accesses the database directly without starting the HTTP server or scheduler
  7. execute_agent runs synchronously and returns the full execution result
**Plans:** 2/2 plans complete

Plans:
- [ ] 14-01-PLAN.md — Install MCP SDK, create entrypoint with stdio transport, agent CRUD + execute + history tools, helpers, and tests
- [ ] 14-02-PLAN.md — Tool CRUD, agent-tool linking, health, schedule parsing tools, wire into entrypoint, and tests

### Phase 15: Telegram Notification Channel

**Goal:** Agent results are delivered via Telegram bot in addition to email, with both channels dispatching independently in parallel and per-channel delivery tracking
**Requirements**: TGRAM-01, TGRAM-02, TGRAM-03, TGRAM-04, TGRAM-05, TGRAM-06, TGRAM-07, TGRAM-08, TGRAM-09, TGRAM-10, TGRAM-11, TGRAM-12
**Depends on:** Phase 14
**Success Criteria** (what must be TRUE):
  1. Telegram notifications send via direct fetch to Telegram Bot API with MarkdownV2 formatting
  2. Both email and Telegram dispatch in parallel via Promise.allSettled after each execution
  3. Neither channel blocks the other -- one failure does not prevent the other from succeeding
  4. Per-channel delivery status tracked independently (emailDeliveryStatus, telegramDeliveryStatus)
  5. Telegram silently skipped when TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars are missing
  6. Telegram messages include bold agent name, timestamp, summary, details, and optional code block data
  7. Messages truncated at ~3800 chars with truncation notice
  8. Failure messages use warning emoji and "FAILED:" header
  9. test_telegram MCP tool verifies bot configuration by sending a test message
  10. Health endpoint includes per-channel delivery stats (email and Telegram sent/failed counts)
**Plans:** 1/2 plans executed

Plans:
- [ ] 15-01-PLAN.md — Telegram utility module (API call, MarkdownV2 escaping), env config, schema telegramDeliveryStatus column, notifier Telegram functions, and tests
- [ ] 15-02-PLAN.md — Executor multi-channel parallel dispatch, test_telegram MCP tool, health per-channel delivery stats, and tests
