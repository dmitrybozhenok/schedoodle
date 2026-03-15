# Schedoodle

Personal AI agent automation platform. Define agents with tasks and cron schedules — Schedoodle executes them through an LLM, tracks results, and delivers notifications.

## Quick Start

```bash
pnpm install
cp .env.example .env  # add your API keys
pnpm db:push          # create SQLite database
pnpm dev              # start server on :3000
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_PROVIDER` | No | `anthropic` | `anthropic` or `ollama` |
| `ANTHROPIC_API_KEY` | If anthropic | — | Anthropic API key |
| `OLLAMA_BASE_URL` | No | `http://127.0.0.1:11434/api` | Ollama endpoint |
| `DATABASE_URL` | No | `./data/schedoodle.db` | SQLite database path |
| `PORT` | No | `3000` | Server port |
| `RESEND_API_KEY` | No | — | Resend API key for email notifications |
| `SMTP_HOST` | No | — | SMTP host (e.g., `localhost` for Mailpit). Preferred over Resend when set |
| `SMTP_PORT` | No | `1025` | SMTP port |
| `NOTIFICATION_EMAIL` | No | — | Recipient email address |
| `NOTIFICATION_FROM` | No | — | Sender email address |
| `GEMINI_API_KEY` | No | — | Gemini API key for eval judge |

## API

### Agents

```
POST   /agents              Create agent
GET    /agents              List agents (?enabled=true/false)
GET    /agents/:id          Get agent
PATCH  /agents/:id          Update agent (partial)
DELETE /agents/:id          Delete agent
POST   /agents/:id/execute  Trigger manual execution
GET    /agents/:id/executions  Execution history (?limit=50)
```

### Schedule Parsing

```
POST   /schedules/parse     Parse natural language to cron expression
```

### Create Agent

`cronSchedule` accepts either a cron expression or natural language:

```bash
curl -X POST http://localhost:3000/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Morning Briefing",
    "taskDescription": "Summarise top tech news from https://news.ycombinator.com",
    "cronSchedule": "every weekday at 8am",
    "systemPrompt": "Be concise. Focus on AI and developer tools."
  }'
```

The response includes the resolved cron expression and a `scheduleNote` with the human-readable interpretation.

### Health

```
GET /health  →  { status, uptimeMs, agentCount, circuitBreaker, recentExecutions }
```

## Architecture

```
src/
  config/       Environment validation, LLM provider resolution, pricing
  db/           Drizzle ORM schema (SQLite), database connection
  helpers/      Pure utilities: cron detection, agent enrichment
  routes/       Hono HTTP handlers (agents CRUD, health, schedule parsing)
  schemas/      Zod schemas for input validation and LLM output
  services/     Core logic: executor, scheduler, prefetch, notifier, schedule-parser, circuit breaker
  types/        TypeScript types inferred from Drizzle schema
```

**Execution flow:** Cron trigger → re-read agent from DB → extract URLs → prefetch content → build prompt → LLM call (with retry) → validate output → record execution → send notification (success or failure)

**Key patterns:**
- Circuit breaker per LLM provider (trips after 3 failures, auto-recovers after 30s)
- Fire-and-forget notifications (delivery failures never affect execution status)
- `Promise.allSettled` for concurrent agent execution
- Croner for cron scheduling with in-process job registry

## Testing

```bash
pnpm test          # 209 unit tests (vitest)
pnpm eval          # 18 eval cases against running server (Layer 1: deterministic)
pnpm eval -- --judge   # + Layer 2: AI-as-judge scoring (Gemini)
```

### Eval Framework

Three-layer evaluation system for LLM output quality:

| Layer | What | How |
|-------|------|-----|
| Deterministic | Schema, keywords, regex, length | JSONL fixtures in `evals/fixtures/` |
| AI-as-Judge | Relevance, accuracy, tone, instruction-following | Gemini or Anthropic with G-Eval rubrics |
| Component | Prefetch, schema validation, pricing | Vitest unit tests |

```bash
pnpm eval -- --tags summarisation     # filter by tag
pnpm eval -- --model qwen2.5-coder:14b-precise  # test specific model
pnpm eval -- --output results.json    # save results
pnpm eval -- --judge-provider anthropic  # use Anthropic as judge
```

## Tech Stack

TypeScript, Hono, Drizzle ORM, SQLite, Vercel AI SDK, Zod, Croner, Cronstrue, Resend, Nodemailer, Vitest, Biome

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm test` | Run unit tests |
| `pnpm eval` | Run eval harness |
| `pnpm lint` | Check code with Biome |
| `pnpm db:push` | Push schema changes to SQLite |
| `pnpm build` | Compile TypeScript |
