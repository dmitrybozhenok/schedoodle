# Project Research Summary

**Project:** Schedoodle -- Scheduled AI Agent System
**Domain:** Cron-driven LLM batch processing with email delivery (personal automation)
**Researched:** 2026-03-14
**Confidence:** MEDIUM

## Executive Summary

Schedoodle is a single-user, cron-driven batch processor that runs AI agents on a schedule and delivers results via email. This is a well-understood architectural pattern -- essentially a task scheduler with an LLM call in the middle. The recommended approach is a single-process Node.js service with in-process scheduling (node-cron), SQLite for persistence, and the Vercel AI SDK for provider-agnostic LLM calls with structured output. The key architectural insight is the "pre-fetch, then LLM" pipeline: agents gather all external data before making a single LLM call, avoiding unpredictable tool-use loops. This makes executions deterministic, debuggable, and cost-predictable.

The stack is modern but conservative: Node.js 22 LTS, TypeScript, Fastify, Drizzle ORM, Zod for validation everywhere. Every library choice serves double duty (Zod validates agent configs, LLM output schemas, and API requests; Pino handles logging and integrates natively with Fastify). The architecture decomposes into clear components -- Scheduler, Agent Registry, Execution Engine, LLM Gateway, Data Fetchers, Notifier -- with a strict build order that lets each phase produce a testable, runnable system increment.

The critical risks center on reliability and cost. Silent schedule failures (the process dies and nobody notices), LLM retry storms (concurrent agents compounding rate limit errors), and unbounded pre-fetch data blowing context windows or budgets. Mitigation requires building observability from day one: execution logging, delivery status tracking, token usage recording, and a watchdog mechanism. The catch-up-on-startup pattern is essential for making in-process cron viable without Redis, but it must include per-agent policies to avoid flooding the system with stale catch-up runs after downtime.

## Key Findings

### Recommended Stack

The stack is Node.js 22 LTS with TypeScript, optimized for a single-process long-running service. The Vercel AI SDK is the centerpiece -- its `generateObject()` function with Zod schemas provides validated, typed LLM responses in one call, which is the core technical enabler for the entire project. SQLite via better-sqlite3 with Drizzle ORM keeps infrastructure minimal (no database server), while node-cron provides in-process scheduling without Redis. See STACK.md for full details.

**Core technologies:**
- **Vercel AI SDK (`ai` + `@ai-sdk/anthropic`):** LLM abstraction -- provider-agnostic structured output via Zod schemas; swap providers without changing agent code
- **better-sqlite3 + Drizzle ORM:** Persistence -- zero-config SQLite with type-safe queries; WAL mode handles concurrent reads during writes
- **node-cron:** Scheduling -- pure JS, in-process cron; right complexity for a single-user tool
- **Fastify:** API server -- fastest Node.js framework with native validation and Pino integration
- **Zod:** Validation everywhere -- agent configs, LLM output schemas, API requests, env vars
- **Resend:** Email delivery -- modern API, free tier sufficient for personal use
- **Pino:** Structured logging -- JSON logs for debugging headless agent runs

### Expected Features

**Must have (table stakes):**
- Agent CRUD via REST API with Zod validation
- Cron-based scheduling with manual trigger / run-now
- LLM execution with structured output (Zod schemas)
- Execution history with logs (status, duration, result, error)
- Email delivery of results
- Graceful failure handling (per-agent isolation)
- Retry with exponential backoff + jitter
- Startup catch-up for missed runs

**Should have (differentiators):**
- Data source pre-fetch layer (deterministic single-LLM-call pattern)
- Per-agent system prompts for tone/expertise differentiation
- Circuit breaker per LLM provider
- Execution cost tracking (token usage)
- Agent enable/disable toggle
- Dry-run mode

**Defer (v2+):**
- Agent-specific email templates (use single template first)
- Timezone-aware scheduling (use UTC, fix when DST causes the first bug)
- Health check endpoint (add when deploying with monitoring)
- Web dashboard, multi-user auth, agent chaining, streaming, plugin system (anti-features)

### Architecture Approach

The system is a pipeline-oriented batch processor. Each agent execution follows a linear pipeline: schedule fires, data is pre-fetched, LLM is called with structured output schema, results are persisted, email is sent. The Management API is purely for CRUD and manual triggers -- it is not on the hot path of agent execution. Single-process architecture is correct for <50 agents. See ARCHITECTURE.md for full component diagrams and data flow.

**Major components:**
1. **Scheduler** -- registers cron jobs, fires callbacks, handles startup catch-up
2. **Agent Registry** -- source of truth for agent definitions; DB-backed with in-memory cache
3. **Execution Engine** -- orchestrates single agent run through the pipeline (fetch, LLM, notify)
4. **LLM Gateway** -- wraps Vercel AI SDK with retry logic and circuit breaker
5. **Data Fetchers** -- pre-fetch external URLs/APIs before LLM call
6. **Notifier** -- formats results and sends email via Resend
7. **Management API** -- REST endpoints for CRUD, history, manual triggers

### Critical Pitfalls

1. **Silent schedule failures** -- In-process cron dies with the process and nobody notices. Mitigate with execution logging from day one, heartbeat tracking, and a watchdog agent that alerts on overdue executions.
2. **LLM retry storms** -- Concurrent agents compound rate limit errors. Mitigate with a shared concurrency queue (p-limit/p-queue), jitter on backoff, and a daily cost ceiling that refuses execution when hit.
3. **Catch-up flooding after downtime** -- Bulk catch-up runs waste money on stale tasks and flood the inbox. Mitigate with per-agent catch-up policies (`always`/`latest`/`skip`) and a maximum catch-up window.
4. **Unbounded LLM context from pre-fetch** -- Data sources grow over time, blowing context windows or budgets. Mitigate with a `maxInputTokens` limit per agent and token estimation before LLM calls.
5. **Fire-and-forget email delivery** -- Results generated but never delivered, silently. Mitigate by tracking `deliveryStatus` in execution records and retrying email independently from LLM execution.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation and Schema
**Rationale:** Everything depends on the database schema and agent definition types. Getting these right (including observability fields) prevents painful migrations later. This is where pitfalls around missing schema fields (deliveryStatus, tokenUsage, modelVersion) must be addressed.
**Delivers:** Database setup with WAL mode, Drizzle schema with all tables, Zod validation schemas for agent definitions, environment config loading and validation.
**Addresses:** Configuration validation, project scaffolding
**Avoids:** Pitfall 8 (SQLite not configured for concurrent access), Pitfall 12 (secrets in agent definitions)

### Phase 2: Core Execution Engine
**Rationale:** The LLM Gateway and Execution Engine are the core value of the product. Build and validate these with hardcoded test agents before adding persistence or scheduling. This phase proves the fundamental pipeline works.
**Delivers:** Working agent execution pipeline -- pre-fetch data, build prompt, call LLM with structured output, get validated result. Mock LLM provider for testing.
**Addresses:** LLM execution with structured output, data source pre-fetch, graceful failure handling
**Avoids:** Pitfall 4 (unbounded context -- build token estimation now), Pitfall 10 (testing with real LLM calls -- establish mock boundary now), Pitfall 7 (prompt drift -- use generateObject from start)

### Phase 3: Persistence and Scheduling
**Rationale:** With the execution engine proven, wrap it in persistence (agent CRUD, execution history) and automation (cron scheduling, catch-up). These are tightly coupled -- scheduling needs persisted agents, catch-up needs execution history.
**Delivers:** Agent Registry with CRUD, execution history recording, cron-based scheduling, startup catch-up with per-agent policies, concurrency control (p-limit).
**Addresses:** Agent CRUD, cron scheduling, execution history, startup catch-up, retry with backoff
**Avoids:** Pitfall 1 (silent schedule failures -- execution logging active), Pitfall 3 (catch-up flooding -- policies built in), Pitfall 2 (retry storms -- shared concurrency queue), Pitfall 6 (cron validation gap)

### Phase 4: Notification and Delivery
**Rationale:** Can be built in parallel with Phase 3. Closes the loop from "agent produces result" to "user receives email." Treating delivery as a first-class pipeline step (not fire-and-forget) is a key pitfall mitigation.
**Delivers:** Email formatting, Resend integration, delivery status tracking, independent email retry logic, notification on both success and failure.
**Addresses:** Email delivery of results, delivery status tracking
**Avoids:** Pitfall 5 (fire-and-forget email delivery)

### Phase 5: Management API and Observability
**Rationale:** Last because it ties everything together but is the least critical for core functionality. Agents can be defined via DB seed initially. The API makes the system user-friendly; observability makes it production-worthy.
**Delivers:** REST endpoints for agent CRUD, manual trigger (run-now), execution history queries, health check endpoint, agent enable/disable toggle.
**Addresses:** Manual trigger/run-now, agent enable/disable, cost tracking exposure, health monitoring
**Avoids:** Pitfall 9 (no observability -- health endpoint built here)

### Phase Ordering Rationale

- **Schema first** because every researcher independently flagged schema design as the foundation that prevents future migrations. The execution history table needs observability fields (deliveryStatus, tokenUsage, modelVersion) from day one even if not populated.
- **Execution engine before scheduling** because the pipeline is the core value. Proving it works with hardcoded agents de-risks the entire project before adding complexity.
- **Scheduling and persistence together** because they are tightly coupled (catch-up needs execution history; scheduling needs persisted agents) and the feature dependencies in FEATURES.md confirm this grouping.
- **Notification as a parallel track** because ARCHITECTURE.md explicitly notes it can be built alongside Phase 3 since it only depends on the execution engine (Phase 2).
- **API last** because it is sugar on top of working infrastructure. The system delivers value (agents run, results arrive) before the API exists.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Execution Engine):** Vercel AI SDK's `generateObject` API and retry behavior need verification against current docs. Structured output schema patterns for different agent types need exploration.
- **Phase 4 (Notification):** Resend API details, domain verification requirements, and email formatting best practices need current documentation review.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** SQLite setup, Drizzle schema definition, and Zod validation are well-documented with stable APIs.
- **Phase 3 (Scheduling):** node-cron is stable and well-documented. Catch-up logic is a custom pattern but straightforward.
- **Phase 5 (Management API):** Fastify REST API patterns are thoroughly documented and stable.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | All libraries are established, but exact version numbers are from training data (May 2025 cutoff). Verify with `npm view` before installing. |
| Features | MEDIUM | Feature landscape is well-understood from automation platform domain knowledge. Feature dependencies and phasing are sound. |
| Architecture | MEDIUM | Pipeline-oriented batch processor is a well-established pattern. Component boundaries are clear. Single-process decision is correct for personal use. |
| Pitfalls | MEDIUM-HIGH | Pitfalls are drawn from well-known failure modes of cron systems, LLM APIs, and SQLite. Prevention strategies are concrete and actionable. |

**Overall confidence:** MEDIUM

The research is consistent across all four files with no contradictions. The main uncertainty is version-specific API details for Vercel AI SDK and Resend, which should be verified against current documentation during implementation. The architectural patterns and pitfall mitigations are based on well-established conventions unlikely to have changed.

### Gaps to Address

- **Vercel AI SDK version verification:** The `ai` package moves fast. Confirm `generateObject` API shape, Zod integration syntax, and provider configuration before Phase 2 implementation.
- **Resend free tier limits:** Verify the 100 emails/day free tier still exists and understand rate limiting behavior before Phase 4.
- **Drizzle ORM migration workflow:** Drizzle is pre-1.0 (0.38). Confirm migration generation and push commands work as documented before Phase 1.
- **Circuit breaker library:** No specific library was committed to (opossum was mentioned). Evaluate whether to use a library or build a simple custom implementation during Phase 3 planning.
- **Structured output schema storage:** How to store per-agent Zod schemas in the database (as JSON Schema? as schema names referencing code-defined schemas?) needs a design decision in Phase 1.

## Sources

### Primary (HIGH confidence)
- PROJECT.md constraints (drove all stack and architecture decisions)
- node-cron, SQLite WAL mode, p-limit concurrency patterns (stable, well-established)

### Secondary (MEDIUM confidence)
- Vercel AI SDK documentation (training data, May 2025 cutoff)
- Drizzle ORM documentation (training data, pre-1.0 library)
- Fastify v5 documentation (training data)
- Resend API patterns (training data)
- Automation platform domain knowledge (n8n, Zapier, Make, Windmill)
- AI agent framework patterns (CrewAI, LangGraph, AutoGen)

### Tertiary (LOW confidence)
- Exact package version numbers (need `npm view` verification)
- Resend free tier pricing (may have changed)
- Biome v1.9 feature set (verify current version)

---
*Research completed: 2026-03-14*
*Ready for roadmap: yes*
