# Feature Landscape

**Domain:** Scheduled AI agent / automation platform (personal use)
**Researched:** 2026-03-14
**Confidence:** MEDIUM (based on training data knowledge of automation platforms like n8n, Zapier, Make, Windmill, and AI agent frameworks like CrewAI, LangGraph; no live web verification available)

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Agent CRUD via API | Users need to create, read, update, delete agents without touching code | Low | REST endpoints for agent lifecycle management |
| Cron-based scheduling | Core promise of the product; without it, it's just a script runner | Medium | Must parse and validate cron expressions; display next-run time |
| LLM execution with structured output | Raw text responses are unusable for downstream processing | Medium | Zod schemas for validated, typed LLM responses |
| Execution history with logs | Users must see what ran, when, whether it worked, and what it returned | Low | Store every execution with status, timestamp, duration, result |
| Email delivery of results | The stated output channel; without it, results are invisible | Low | Format results into readable emails; include agent name + timestamp |
| Graceful failure handling | A single agent failure must never crash the service or block other agents | Medium | Try/catch per execution, store error details, continue schedule |
| Retry with backoff | LLM APIs are unreliable; users expect the system to retry without manual intervention | Medium | Exponential backoff with jitter; configurable max retries |
| Manual trigger / run-now | Users will always want to test an agent immediately without waiting for schedule | Low | API endpoint to trigger any agent on demand |
| Configuration validation | Bad cron expressions or missing fields should fail fast at creation time, not at runtime | Low | Zod validation on agent create/update |
| Startup catch-up for missed runs | If the service was down at 7am, the morning briefing should still run when it comes back | Medium | Compare last-run time to schedule on startup; execute if overdue |

## Differentiators

Features that set product apart. Not expected in a v1, but provide real value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Data source pre-fetch layer | Agents fetch URLs/APIs before the LLM call, making tasks deterministic and cheap (one LLM call, not a tool-use loop) | Medium | This is a genuine architectural differentiator vs agent frameworks that rely on tool calling |
| Per-agent system prompts | Each agent has its own personality/expertise, not just a task description | Low | Enables "security analyst" vs "friendly morning host" tone differentiation |
| Circuit breaker per provider | Prevents hammering a downed LLM API; auto-recovers when it comes back | Medium | Most personal tools don't bother; this prevents cascading failures and wasted spend |
| Structured result schemas per agent | Each agent defines its own Zod output schema, so results are typed and parseable | Medium | Enables email templates, conditional logic, and future integrations without parsing free text |
| Agent-specific email templates | Format email output differently per agent (briefing vs alert vs digest) | Medium | Transforms generic results into purpose-built communications |
| Execution cost tracking | Track token usage and estimated cost per agent per run | Low | Prevents bill shock; identifies expensive agents; enables budget alerts |
| Dry-run mode | Execute everything except the actual LLM call and email send; validate data fetching and schema | Low | Crucial for development and debugging agents |
| Agent enable/disable toggle | Pause an agent without deleting it | Low | Table stakes for any mature scheduler, but many v1s skip it |
| Timezone-aware scheduling | Cron expressions interpreted in user's timezone, not UTC | Low | "7am daily" must mean 7am local time, including DST transitions |
| Health check endpoint | Simple `/health` that reports service status, last successful run, queue depth | Low | Essential for monitoring but often forgotten in personal tools |

## Anti-Features

Features to explicitly NOT build. These add complexity without proportional value for a personal automation tool.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Web dashboard / UI | Massive scope expansion; API-first is correct for v1; curl + a future CLI cover the use case | Provide clean REST API with good documentation; build UI only if API proves insufficient |
| Multi-user / authentication | Auth is a rabbit hole (sessions, tokens, RBAC, password reset); this is a personal tool | Run on localhost or behind a VPN; add auth only when/if sharing |
| Agent chaining / workflows | DAG-based workflows are an entire product category (Temporal, Windmill, n8n); building this poorly is worse than not having it | Keep agents independent; if results feed into other agents, let the user create a separate agent that queries the first's history |
| Real-time streaming | Agents are batch jobs; streaming adds SSE/WebSocket complexity for zero user value | Return complete results; execution takes seconds, not minutes |
| Multiple notification channels (Slack, webhooks, SMS) | Each channel has its own auth, formatting, rate limits, and failure modes | Email only for v1; design the notification layer as pluggable so channels can be added later without refactoring |
| LLM tool-use / function-calling loops | Unpredictable cost and latency; pre-fetch pattern is cheaper and more reliable | Pre-fetch all data, then make one LLM call; deterministic and debuggable |
| Plugin / extension system | Premature abstraction; you don't know what the extension points should be yet | Build concrete features; extract extension points after patterns emerge |
| Natural language schedule input ("every weekday at 9am") | Parsing natural language into cron is its own NLP problem and error-prone | Use cron expressions with a human-readable description field; link to crontab.guru in docs |
| Agent marketplace / sharing | No users to share with; premature community features | Keep agent definitions as JSON; users can copy-paste configs |
| Complex approval workflows | Overkill for personal automation; adds latency to the core value (things run automatically) | If review is needed, send a preview email and let the user decide manually |

## Feature Dependencies

```
Configuration validation --> Agent CRUD (validation is part of create/update)
Cron scheduling --> Agent CRUD (must have agents to schedule)
LLM execution --> Agent CRUD (must have agent definition to execute)
Startup catch-up --> Cron scheduling + Execution history (needs schedule + last-run time)
Email delivery --> LLM execution (must have results to send)
Retry with backoff --> LLM execution (retries happen during execution)
Circuit breaker --> Retry with backoff (circuit breaker wraps the retry layer)
Data source pre-fetch --> LLM execution (pre-fetch feeds into LLM context)
Structured result schemas --> LLM execution (schemas validate LLM output)
Agent-specific email templates --> Email delivery + Structured result schemas (templates consume typed results)
Execution cost tracking --> LLM execution (token counts come from API response)
Dry-run mode --> Data source pre-fetch + LLM execution (skips LLM call, tests everything else)
```

## MVP Recommendation

**Prioritize (Phase 1 -- working agent):**
1. Agent CRUD with validation (foundation for everything)
2. LLM execution with structured output (core value)
3. Manual trigger / run-now (test without waiting)
4. Execution history with logs (observability from day one)

**Prioritize (Phase 2 -- automated delivery):**
5. Cron-based scheduling (the "scheduled" in the product name)
6. Startup catch-up (reliability for the schedule)
7. Retry with backoff (reliability for the LLM calls)
8. Email delivery (close the loop: schedule -> execute -> deliver)

**Prioritize (Phase 3 -- production-grade):**
9. Data source pre-fetch layer (enables real use cases)
10. Circuit breaker per provider (resilience)
11. Agent enable/disable toggle (operational convenience)
12. Cost tracking (budget awareness)

**Defer:**
- Agent-specific email templates: Only matters when you have 5+ agents with different output formats. Use a single clean template first.
- Dry-run mode: Nice for debugging but manual trigger covers most testing needs initially.
- Timezone-aware scheduling: Use UTC initially; add timezone support when DST causes the first bug.
- Health check endpoint: Add when deploying to a server with monitoring.

## Sources

- Domain knowledge from automation platforms: n8n, Zapier, Make (Integromat), Windmill, Activepieces
- AI agent frameworks: CrewAI, LangGraph, AutoGen, Semantic Kernel
- Scheduling infrastructure: Temporal, BullMQ, Agenda.js, node-cron
- LLM API patterns: OpenAI, Anthropic, Vercel AI SDK usage patterns
- Note: Web search was unavailable; findings are based on training data (MEDIUM confidence)
