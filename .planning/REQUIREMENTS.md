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

- [ ] **HLTH-01**: Execution history records retryCount (number of LLM validation retries per execution)
- [ ] **HLTH-02**: Each agent has a healthy boolean flag computed from consecutive failure count
- [ ] **HLTH-03**: An agent with 3 consecutive failures is flagged unhealthy; auto-recovers on next success
- [ ] **HLTH-04**: Health endpoint includes per-agent breakdown with lastRunAt, lastStatus, successRate, avgDurationMs, healthy, consecutiveFailures
- [ ] **HLTH-05**: Health endpoint includes next 5 upcoming scheduled runs across all agents
- [ ] **HLTH-06**: Agent API responses (GET /agents, GET /agents/:id) include healthy and consecutiveFailures via enrichAgent
- [ ] **HLTH-07**: GET /agents/:id/executions defaults to 100 results (max 200)
- [ ] **HLTH-08**: Health endpoint top-level status reflects system health: ok / degraded / unhealthy
- [ ] **HLTH-09**: Scheduler exposes its job registry for external consumers (upcoming runs)
- [ ] **HLTH-10**: Health endpoint includes system-wide successRate and avgDurationMs aggregates (24h window)

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
| Multi-user / authentication | Personal tool; run on localhost or behind VPN |
| Agent chaining / workflows | Independent agents only; workflow orchestration is an entire product category |
| Real-time streaming | Agents are batch jobs; streaming adds complexity for zero value |
| Multiple notification channels | Email only; design notifier as pluggable for future channels |
| LLM tool-use / function-calling loops | Pre-fetch pattern is cheaper, more reliable, and deterministic |
| Plugin / extension system | Premature abstraction; extract extension points after patterns emerge |
| ~~Natural language schedule input~~ | ~~Use cron expressions; link to crontab.guru in docs~~ — Implemented in Phase 7 |
| Agent marketplace / sharing | No users to share with; copy-paste JSON configs instead |

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
| HLTH-01 | Phase 8 | Planned |
| HLTH-02 | Phase 8 | Planned |
| HLTH-03 | Phase 8 | Planned |
| HLTH-04 | Phase 8 | Planned |
| HLTH-05 | Phase 8 | Planned |
| HLTH-06 | Phase 8 | Planned |
| HLTH-07 | Phase 8 | Planned |
| HLTH-08 | Phase 8 | Planned |
| HLTH-09 | Phase 8 | Planned |
| HLTH-10 | Phase 8 | Planned |

**Coverage:**
- v1 requirements: 33 total
- Mapped to phases: 33
- Unmapped: 0

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-15 after Phase 8 planning*
