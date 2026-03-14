# Architecture Patterns

**Domain:** Scheduled AI Agent System (personal automation)
**Researched:** 2026-03-14
**Confidence:** MEDIUM (based on established patterns for cron-driven systems, Vercel AI SDK conventions, and SQLite-backed Node.js services; web search unavailable for latest-source verification)

## Recommended Architecture

Schedoodle is a **pipeline-oriented, cron-driven batch processor**. Each agent execution follows a linear pipeline: Schedule triggers Execution, Execution fetches data, calls LLM, persists results, and dispatches notification. There is no request/response user-facing hot path for agent runs -- the API is purely for management CRUD.

```
                        +------------------+
                        |   Management API |  (Express/Fastify)
                        |   CRUD + History |
                        +--------+---------+
                                 |
                                 v
+-------------+       +-------------------+       +----------------+
|  Scheduler  | ----> |   Agent Registry  | <---> |    Database     |
|  (node-cron)|       | (in-memory + DB)  |       |   (SQLite +    |
+-------------+       +-------------------+       |    Drizzle)    |
       |                                          +----------------+
       v                                                  ^
+------------------+                                      |
| Execution Engine |                                      |
|  (per-agent run) |--------------------------------------+
+------------------+       writes execution results
       |
       | 1. Pre-fetch    2. LLM Call       3. Notify
       v                 v                 v
+------------+   +---------------+   +----------+
| Data       |   | LLM Gateway   |   | Notifier |
| Fetchers   |   | (Vercel AI    |   | (Resend) |
| (fetch/    |   |  SDK)         |   +----------+
|  axios)    |   +---------------+
+------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With | Interface Style |
|-----------|---------------|-------------------|-----------------|
| **Scheduler** | Registers cron jobs, fires at schedule, handles catch-up on startup | Agent Registry, Execution Engine | Event-driven (fires callbacks) |
| **Agent Registry** | Source of truth for agent definitions; loads from DB, caches in memory | Database, Scheduler, Management API | Function calls (getAgent, listAgents) |
| **Execution Engine** | Orchestrates a single agent run through the pipeline | Data Fetchers, LLM Gateway, Notifier, Database | Async function: `executeAgent(agentId): ExecutionResult` |
| **Data Fetchers** | Pre-fetch external data (URLs, APIs) before LLM call | External HTTP endpoints | Async function: `fetchData(sources): FetchedData[]` |
| **LLM Gateway** | Wraps Vercel AI SDK; handles retries, circuit breaker, structured output | Anthropic/OpenAI APIs via AI SDK | Async function: `callLLM(prompt, schema): StructuredOutput` |
| **Notifier** | Formats and sends email with agent results | Resend API | Async function: `notify(result): void` |
| **Database** | Persists agent definitions, execution history, schedule metadata | SQLite file via Drizzle ORM | Drizzle query builder |
| **Management API** | REST endpoints for agent CRUD, execution history, manual triggers | Agent Registry, Execution Engine, Database | HTTP REST (JSON) |

### Data Flow

**Agent Execution Pipeline (the core flow):**

```
1. Scheduler fires cron tick
   |
2. Scheduler looks up agent definition from Registry
   |
3. Execution Engine starts a run:
   a. Create execution record in DB (status: "running", started_at: now)
   b. Data Fetchers pull external data (URLs, APIs) -- parallel where possible
   c. Build LLM prompt: system prompt + task description + fetched data
   d. LLM Gateway sends prompt to provider, receives structured response
   e. On success: update execution record (status: "success", result, completed_at)
      On failure: update execution record (status: "failed", error, completed_at)
   f. Notifier sends email with formatted result (success or failure summary)
   |
4. Done. No return value needed -- fire-and-forget from scheduler's perspective.
```

**Management API Flow (secondary):**

```
HTTP Request --> Router --> Controller --> Service Layer --> Database
                                      |
                                      +--> Execution Engine (for manual trigger)
```

**Startup Flow (critical for reliability):**

```
1. Initialize database connection + run migrations
2. Load all agent definitions from DB into Agent Registry
3. For each agent:
   a. Register cron job with Scheduler
   b. Check last execution time vs. cron schedule
   c. If missed execution(s) since last run: queue immediate catch-up execution
4. Start Management API HTTP server
5. Log "Schedoodle started, N agents registered, M catch-up runs queued"
```

## Patterns to Follow

### Pattern 1: Execution Pipeline with Isolated Steps

**What:** Each step in the agent execution pipeline is an independent async function. The Execution Engine orchestrates them sequentially. Each step receives input and returns output -- no shared mutable state between steps.

**When:** Always. This is the core pattern.

**Why:** Testable in isolation. Easy to add steps (e.g., post-processing). Failures are attributable to a specific step. Retries can target the failing step.

```typescript
// Each step is a pure-ish async function
interface ExecutionPipeline {
  fetchData(sources: DataSource[]): Promise<FetchedData[]>;
  buildPrompt(agent: Agent, data: FetchedData[]): string;
  callLLM(prompt: string, schema: ZodSchema): Promise<StructuredOutput>;
  notify(agent: Agent, result: ExecutionResult): Promise<void>;
}

// Engine orchestrates
async function executeAgent(agent: Agent): Promise<ExecutionResult> {
  const execution = await db.createExecution(agent.id, "running");
  try {
    const data = await pipeline.fetchData(agent.sources);
    const prompt = pipeline.buildPrompt(agent, data);
    const output = await pipeline.callLLM(prompt, agent.outputSchema);
    const result = { status: "success", output, completedAt: new Date() };
    await db.updateExecution(execution.id, result);
    await pipeline.notify(agent, result);
    return result;
  } catch (error) {
    const result = { status: "failed", error: String(error), completedAt: new Date() };
    await db.updateExecution(execution.id, result);
    await pipeline.notify(agent, result); // notify on failure too
    return result;
  }
}
```

### Pattern 2: LLM Gateway with Retry + Circuit Breaker

**What:** Wrap all LLM calls through a single gateway that handles transient failures (retries with exponential backoff + jitter) and persistent failures (circuit breaker that stops hammering a down provider).

**When:** Every LLM call. Never call the AI SDK directly from the Execution Engine.

**Why:** LLM APIs have variable latency and availability. Without retry logic, a single 503 kills an agent run. Without a circuit breaker, a downed API causes all agents to pile up failed requests and burn rate limits.

```typescript
// Retry: 3 attempts, exponential backoff (1s, 2s, 4s) + jitter
// Circuit breaker: open after 5 failures in 60s, half-open after 30s
interface LLMGateway {
  generate<T>(options: {
    model: string;
    system: string;
    prompt: string;
    schema: ZodSchema<T>;
  }): Promise<T>;
}
```

### Pattern 3: Agent Definition as Data, Not Code

**What:** Agents are stored as database rows with declarative configuration (name, task prompt, system prompt, cron expression, data sources). No per-agent code files.

**When:** Always. This is what makes agents manageable via API.

**Why:** Agents are user-defined at runtime, not developer-defined at compile time. Storing them as data means CRUD via API, no deployments for new agents, and the system scales to any number of agents without code changes.

```typescript
interface AgentDefinition {
  id: string;
  name: string;
  taskDescription: string;    // The prompt sent to the LLM
  systemPrompt?: string;      // Optional system-level instructions
  cronExpression: string;     // e.g., "0 7 * * *" for daily 7am
  dataSources?: DataSource[]; // URLs/APIs to pre-fetch
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Pattern 4: Catch-Up on Startup

**What:** On startup, compare each agent's last execution time against its cron schedule. If any scheduled runs were missed (e.g., service was down), execute them immediately.

**When:** Every startup.

**Why:** In-process cron (node-cron) loses state when the process stops. Without catch-up, a restart at 7:05am means the 7:00am morning briefing never runs. This is the critical reliability pattern that makes in-process cron viable without Redis/external job queues.

```typescript
async function catchUpMissedRuns(agents: Agent[]): Promise<void> {
  for (const agent of agents) {
    const lastRun = await db.getLastExecution(agent.id);
    const missedSlots = getMissedCronSlots(agent.cronExpression, lastRun?.startedAt);
    if (missedSlots.length > 0) {
      // Run once for catch-up (not N times for N missed slots)
      logger.info(`Catch-up: ${agent.name} missed ${missedSlots.length} runs`);
      await executeAgent(agent);
    }
  }
}
```

### Pattern 5: Structured Output via Zod Schemas

**What:** Every LLM call defines its expected output shape as a Zod schema. The Vercel AI SDK validates the response against this schema automatically.

**When:** Every LLM call.

**Why:** Unstructured LLM output is fragile to parse, inconsistent across runs, and hard to render in emails. Structured output (via Vercel AI SDK's `generateObject`) guarantees the shape. If the LLM can't conform, it throws -- which the retry logic handles.

```typescript
const briefingSchema = z.object({
  summary: z.string(),
  items: z.array(z.object({
    title: z.string(),
    priority: z.enum(["high", "medium", "low"]),
    detail: z.string(),
  })),
});
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Tool-Use / Multi-Turn Agent Loops

**What:** Having the LLM call tools (fetch URLs, query APIs) in a multi-turn loop where it decides what to fetch next.

**Why bad:** Unpredictable cost (N tool calls = N LLM round-trips), unpredictable latency, harder to debug, harder to test. The LLM might fetch the wrong thing or loop excessively.

**Instead:** Pre-fetch all data before the LLM call. The LLM receives data, not tools. One LLM call per agent run. This is already a stated constraint in PROJECT.md -- enforce it architecturally by never passing tools to the AI SDK call.

### Anti-Pattern 2: Global Error Swallowing

**What:** Catching all errors at the top level and logging them without updating the execution record or notifying.

**Why bad:** Silent failures mean the user never knows their morning briefing didn't run. The whole point of the system is reliability.

**Instead:** Every failure path must: (1) update the execution record with error details, (2) attempt notification (with its own error handling), (3) log for operator visibility.

### Anti-Pattern 3: Shared Mutable Scheduler State

**What:** Storing running/pending execution state in the scheduler itself, making the scheduler stateful beyond cron registration.

**Why bad:** Couples scheduling logic with execution logic. Makes it hard to test either in isolation. Creates race conditions if a cron fires while a previous run is still executing.

**Instead:** The Scheduler only fires events. The Execution Engine checks if a previous run is still in progress (via DB query on execution records) and decides whether to skip or queue.

### Anti-Pattern 4: Direct Database Access from Handlers

**What:** API route handlers writing raw SQL or calling Drizzle directly, bypassing service layer.

**Why bad:** Business logic leaks into HTTP layer. Can't reuse logic (e.g., manual trigger via API needs same validation as scheduler trigger). Harder to test.

**Instead:** Service layer (Agent Service, Execution Service) owns all business logic. API handlers call services. Scheduler calls services. Both go through the same code path.

## Component Build Order (Dependencies)

The following build order respects dependencies -- each phase only depends on components from prior phases:

```
Phase 1: Foundation (no dependencies)
  - Database schema + Drizzle setup
  - Agent definition types + validation (Zod schemas)
  - Configuration loading

Phase 2: Core Engine (depends on Phase 1)
  - LLM Gateway (Vercel AI SDK wrapper with retry + circuit breaker)
  - Execution Engine (pipeline orchestrator)
  - Data Fetchers (HTTP pre-fetch)
  These three compose into: given an agent definition, produce a result.

Phase 3: Persistence + Scheduling (depends on Phase 1 + 2)
  - Agent Registry (CRUD in DB, in-memory cache)
  - Execution history persistence
  - Scheduler (node-cron registration)
  - Catch-up on startup logic
  These make agents persistent and automatic.

Phase 4: Notification (depends on Phase 2)
  - Email formatter (structured result -> HTML email)
  - Resend integration
  - Notification on success + failure
  Can be built in parallel with Phase 3.

Phase 5: Management API (depends on Phase 1 + 2 + 3)
  - REST endpoints for agent CRUD
  - Manual trigger endpoint
  - Execution history endpoint
  Last because it ties everything together and is the least critical
  for core functionality (agents can be defined via DB seed initially).
```

**Key dependency insight:** The LLM Gateway and Execution Engine (Phase 2) are the core value. Everything else wraps around them. Build and validate Phase 2 first, even if agents are hardcoded. Scheduling and persistence make it production-worthy. The API makes it user-friendly.

## Scalability Considerations

| Concern | At 5 agents | At 50 agents | At 500 agents |
|---------|-------------|--------------|---------------|
| **Concurrency** | Sequential execution fine | Need concurrency limit (3-5 parallel) | Need proper job queue (BullMQ) |
| **Database** | SQLite trivially handles | SQLite fine with WAL mode | Consider Postgres migration |
| **LLM rate limits** | Not a concern | May hit provider rate limits | Need per-provider rate limiting + multiple API keys |
| **Memory** | Negligible | Watch for large pre-fetched data | Stream/chunk large fetches |
| **Email** | Resend free tier (100/day) | May exceed free tier | Need paid plan or batching |
| **Startup catch-up** | Instant | 5-10 seconds | Need to stagger catch-up runs |

For a personal tool (5-20 agents), none of these are concerns. The architecture supports growth to ~50 agents without changes. Beyond that, the main pressure points are SQLite write contention and LLM rate limits.

## Key Architectural Decisions

### Single-Process vs. Worker Separation

**Decision:** Single process. The scheduler, execution engine, and API all run in one Node.js process.

**Rationale:** For a personal tool with <50 agents, process separation adds deployment complexity without benefit. Node.js handles I/O-bound concurrency well. A long-running LLM call (30s) doesn't block the API because both are async. If an agent execution crashes the process, the catch-up-on-startup pattern recovers on restart.

**Migration path:** If needed later, extract the Execution Engine into a worker process that polls a job queue. The pipeline architecture makes this straightforward -- the Execution Engine is already a standalone async function.

### Concurrency Control

**Decision:** Simple semaphore limiting concurrent agent executions (e.g., max 3 simultaneous).

**Rationale:** Without limits, 10 agents scheduled at the same minute all fire simultaneously, potentially exhausting LLM rate limits or memory. A semaphore (or p-limit library) gates concurrent execution without needing a full job queue.

```typescript
import pLimit from "p-limit";
const executionLimit = pLimit(3); // max 3 concurrent agent runs

// Scheduler fires:
executionLimit(() => executeAgent(agent));
```

## Sources

- Project requirements from `.planning/PROJECT.md` (primary source for constraints and decisions)
- Vercel AI SDK documentation (training data, MEDIUM confidence) -- `generateObject` with Zod schemas for structured output
- node-cron library conventions (training data, MEDIUM confidence) -- standard callback-based cron registration
- Resend API patterns (training data, MEDIUM confidence) -- simple `resend.emails.send()` interface
- Circuit breaker pattern: well-established (Hystrix, opossum library for Node.js)
- p-limit for concurrency control: standard Node.js pattern (HIGH confidence, widely used)

**Confidence note:** Web search was unavailable during research. Architecture patterns are based on well-established conventions for cron-driven Node.js services and Vercel AI SDK usage from training data. The overall architecture confidence is MEDIUM -- the patterns are standard and unlikely to have changed, but specific API details (especially Vercel AI SDK latest version) should be verified against current docs during implementation.
