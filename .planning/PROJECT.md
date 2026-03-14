# Schedoodle

## What This Is

A system that lets you define named AI agents, each with a task description and a cron schedule, that run automatically and deliver their results by email. It's a personal automation platform for recurring AI-powered tasks like morning briefings, dependency watches, outage digests, and PR review reminders.

## Core Value

Agents run reliably on schedule, process tasks through an LLM, and deliver structured results — without manual intervention.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Define agents with a name, task description, and optional system prompt
- [ ] Execute agents manually — send task to LLM and get structured result back
- [ ] Structured results include agent name, timestamp, success/failure status, and LLM response
- [ ] Agents handle failure gracefully (no crashes on impossible tasks)
- [ ] Persist agent definitions and execution history in a database
- [ ] Schedule agents with cron expressions to run automatically
- [ ] Catch up on missed jobs when the service restarts
- [ ] Retry failed LLM calls with exponential backoff and jitter
- [ ] Circuit breaker per LLM provider to prevent hammering downed APIs
- [ ] Deliver agent results via email notifications
- [ ] Agents can fetch external data (URLs, APIs) before calling the LLM
- [ ] Manage agents via API (create, update, delete, list, view history)

### Out of Scope

- Web frontend / dashboard — API-first, build UI later
- Multi-user / authentication — personal tool, single user
- Real-time streaming — agents are background batch jobs
- Multiple notification channels (Slack, webhooks) — email only for v1
- Agent chaining / workflows — each agent is independent for now

## Context

This is a progressive challenge project, built step-by-step:
- **Step 0:** Environment setup — tooling, project skeleton, database schema
- **Step 1:** Basic AI agent — thin LLM wrapper with structured results
- **Step 2+:** Scheduling, persistence, retry logic, email delivery, management API

Use cases that inform design:
- **Morning Briefing:** Daily at 7am, pulls email/calendar/news, delivers structured brief
- **Weekly Dependency Watch:** Mondays at 8am, checks dependencies for releases/advisories
- **Daily Outage Digest:** Every few hours, checks status pages of dependent services
- **Weekly Tech Radar:** Mondays, scans HN/blogs/release notes for chosen tech areas
- **PR Review Reminder:** Twice daily, summarizes open PRs awaiting review

## Constraints

- **Tech stack**: TypeScript on Node.js 20+ — best LLM SDK support and iteration speed
- **Database**: SQLite via better-sqlite3 + Drizzle ORM — zero ops, single file, type-safe
- **Scheduler**: node-cron with catch-up-on-startup pattern — no Redis dependency
- **LLM**: Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) — provider-swappable, structured output via Zod
- **Email**: Resend — modern API, generous free tier, simple setup
- **Testing**: Vitest — fast, native TS support
- **Validation**: Zod — config validation and LLM output schemas
- **Architecture**: Pre-fetch data before LLM call (not via tool use) — cheaper, more reliable, deterministic

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Python/Go/Rust | Best LLM SDK support, type safety, iteration speed for I/O-bound workload | — Pending |
| SQLite over Postgres/Redis | Zero infrastructure for a personal tool; Drizzle enables easy Postgres migration later | — Pending |
| Vercel AI SDK over direct provider SDKs | Provider abstraction with structured output via Zod; trivial to swap providers | — Pending |
| In-process cron over BullMQ/Redis | Simpler; catch-up-on-startup covers missed jobs adequately for personal use | — Pending |
| Pre-fetch data before LLM call | One LLM call vs multiple round-trips; cheaper, more reliable, easier to debug | — Pending |
| Resend over Nodemailer/SendGrid | Modern DX, 100 emails/day free, no SMTP deliverability headaches | — Pending |
| API-first, no frontend | Build and test via curl/CLI; add UI later without restructuring | — Pending |

---
*Last updated: 2026-03-14 after initialization*
