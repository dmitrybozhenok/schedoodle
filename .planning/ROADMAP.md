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
- [ ] **Phase 3: Management API and Scheduling** - Agent CRUD endpoints, system prompts, and cron-based automatic execution
- [ ] **Phase 4: Resilience and Observability** - Circuit breaker, token tracking, cost estimation, and health check endpoint
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
**Plans:** 2 plans
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
**Plans**: TBD

### Phase 5: Notification
**Goal**: Agent results are automatically delivered to the user's inbox after each execution
**Depends on**: Phase 4
**Requirements**: NOTF-01, NOTF-02
**Success Criteria** (what must be TRUE):
  1. After a successful agent execution, an email is sent containing the results without manual intervention
  2. The email includes the agent name, execution timestamp, and formatted results in a readable layout
  3. Email delivery failures do not cause the execution to be marked as failed (delivery is tracked independently)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and Schema | 1/1 | Complete | 2026-03-14 |
| 2. Execution Engine | 2/2 | Complete   | 2026-03-14 |
| 3. Management API and Scheduling | 0/2 | Not started | - |
| 4. Resilience and Observability | 0/? | Not started | - |
| 5. Notification | 0/? | Not started | - |
