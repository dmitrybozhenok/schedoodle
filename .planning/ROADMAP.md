# Roadmap: Schedoodle

## Overview

Schedoodle delivers a personal AI agent automation platform in five phases. We start by laying the database schema and project foundation, then build the core LLM execution pipeline that proves agents can process tasks and return structured results. From there we add the management API and cron scheduling so agents run automatically, harden the system with circuit breakers and observability, and finally close the loop with email delivery of results.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation and Schema** - Project scaffold, database schema, agent persistence, and configuration validation
- [x] **Phase 2: Execution Engine** - Core LLM pipeline with structured output, data pre-fetch, and graceful failure handling (completed 2026-03-14)
- [x] **Phase 3: Management API and Scheduling** - Agent CRUD endpoints, system prompts, and cron-based automatic execution (completed 2026-03-14)
- [x] **Phase 4: Resilience and Observability** - Circuit breaker, token tracking, cost estimation, and health check endpoint (completed 2026-03-14)
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
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and Schema | 1/1 | Complete | 2026-03-14 |
| 2. Execution Engine | 2/2 | Complete   | 2026-03-14 |
| 3. Management API and Scheduling | 2/2 | Complete   | 2026-03-14 |
| 4. Resilience and Observability | 2/2 | Complete   | 2026-03-14 |
| 5. Notification | 2/2 | Complete   | 2026-03-14 |
| 6. Agent Enabled Flag and Schedule Controls | 2/2 | Complete   | 2026-03-14 |
| 7. Natural Language Schedule Parsing | 2/2 | Complete   | 2026-03-15 |

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
  3. If input is already a valid cron expression, it is described without an LLM call
  4. Ambiguous input returns a low-confidence warning so users can verify
  5. Unparseable input returns a 422 with guidance and example suggestions
  6. LLM unavailability returns a 503 with fallback guidance to use raw cron
**Plans:** 2 plans
Plans:
- [x] 07-01-PLAN.md — Cron detection helper, schedule parse schemas, NL-to-cron parser service with LLM + cronstrue, and unit tests
- [x] 07-02-PLAN.md — POST /schedules/parse route, wire into index.ts, and route-level tests
