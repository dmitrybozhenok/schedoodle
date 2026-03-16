# Schedoodle

Personal AI agent automation platform. Define agents with tasks and cron schedules — Schedoodle executes them through an LLM, tracks results, and delivers notifications via email and Telegram. Manage everything through a REST API, MCP server (Claude Code), or natural language Telegram commands.

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
| `AUTH_TOKEN` | No | — | Bearer token for API authentication (all endpoints open if unset) |
| `RESEND_API_KEY` | No | — | Resend API key for email notifications |
| `SMTP_HOST` | No | — | SMTP host (e.g., `localhost` for Mailpit). Preferred over Resend when set |
| `SMTP_PORT` | No | `1025` | SMTP port |
| `NOTIFICATION_EMAIL` | No | — | Recipient email address |
| `NOTIFICATION_FROM` | No | — | Sender email address |
| `TELEGRAM_BOT_TOKEN` | No | — | Telegram Bot API token for notifications and bot control |
| `TELEGRAM_CHAT_ID` | No | — | Telegram chat ID for notifications and authorized bot commands |
| `BRAVE_API_KEY` | No | — | Brave Search API key (for `web_search` built-in tool) |
| `MAX_CONCURRENT_LLM` | No | `3` | Maximum concurrent LLM calls (semaphore) |
| `RETENTION_DAYS` | No | `30` | Days to retain execution history (pruned on startup) |
| `GEMINI_API_KEY` | No | — | Gemini API key for eval judge |

## API

All endpoints require `Authorization: Bearer <AUTH_TOKEN>` when `AUTH_TOKEN` is set.

### Agents

```
POST   /agents              Create agent
GET    /agents              List agents (?enabled=true/false)
GET    /agents/:id          Get agent
PATCH  /agents/:id          Update agent (partial)
DELETE /agents/:id          Delete agent
POST   /agents/:id/execute  Trigger manual execution
GET    /agents/:id/executions  Execution history (?limit=100, max 200)
```

### Tools

```
POST   /tools               Create custom webhook tool
GET    /tools                List tools
GET    /tools/:id            Get tool
PATCH  /tools/:id            Update tool
DELETE /tools/:id            Delete tool
POST   /agents/:id/tools/:toolId   Attach tool to agent
DELETE /agents/:id/tools/:toolId   Detach tool from agent
GET    /agents/:id/tools     List agent's attached tools
```

### Schedule Parsing

```
POST   /schedules/parse     Parse natural language to cron expression
```

### Health

```
GET /health  →  { status, uptimeMs, agents[], circuitBreaker, concurrency, deliveryStats }
```

Returns per-agent health breakdown, upcoming scheduled runs, system-wide aggregates, and per-channel delivery stats.

### Create Agent

`cronSchedule` accepts either a cron expression or natural language:

```bash
curl -X POST http://localhost:3000/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "name": "Morning Briefing",
    "taskDescription": "Summarise top tech news from https://news.ycombinator.com",
    "cronSchedule": "every weekday at 8am",
    "systemPrompt": "Be concise. Focus on AI and developer tools."
  }'
```

The response includes the resolved cron expression and a `scheduleNote` with the human-readable interpretation.

## Telegram Bot

When `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are configured, the bot provides two-way control:

**Notifications** — Agent results are delivered via Telegram (in parallel with email) with MarkdownV2 formatting.

**Natural language commands** — Send messages to manage agents:

```
list agents              Show all agents with status
run Morning Briefing     Execute an agent
enable/disable X         Toggle agent scheduling
change X to daily at 9am   Update schedule (NL-to-cron)
status                   System health summary
/help                    Show available commands
```

Only messages from the configured `TELEGRAM_CHAT_ID` are processed.

## MCP Server

Schedoodle exposes all management capabilities via MCP (Model Context Protocol) for Claude Code integration:

```bash
pnpm mcp        # development (tsx)
pnpm mcp:start  # production (compiled)
```

17 tools available: agent CRUD, execute, history, tool CRUD, agent-tool linking, health, schedule parsing, and Telegram testing. Add to your Claude Code config:

```json
{
  "mcpServers": {
    "schedoodle": {
      "command": "node",
      "args": ["dist/mcp.js"],
      "cwd": "/path/to/schedoodle"
    }
  }
}
```

## Architecture

```
src/
  config/       Environment validation, LLM provider, pricing constants
  db/           Drizzle ORM schema (SQLite), database connection
  helpers/      Pure utilities: cron detection, agent enrichment
  mcp/          MCP server: tool definitions, helpers (stdio transport)
  middleware/   Auth, rate limiter, security headers, CORS
  routes/       Hono HTTP handlers (agents, tools, health, schedules, dashboard)
  schemas/      Zod schemas for input validation and LLM output
  services/     Core logic: executor, scheduler, prefetch, notifier, circuit breaker,
                semaphore, schedule-parser, Telegram (poller, commands, intent-parser),
                tools (web-fetch, web-search, webhook, registry)
  types/        TypeScript types inferred from Drizzle schema
```

**Execution flow:** Cron trigger → re-read agent from DB → build tool registry (built-ins + custom) → extract URLs → prefetch content → build prompt → LLM `generateText` with tools (up to 10 steps) → validate output → record execution → notify via email + Telegram in parallel

**Key patterns:**
- Circuit breaker per LLM provider (trips after 3 failures, auto-recovers after 30s)
- Counting semaphore for LLM concurrency control (configurable via `MAX_CONCURRENT_LLM`)
- Fire-and-forget notifications with per-channel delivery tracking (`Promise.allSettled`)
- Graceful shutdown: drain in-flight executions with 30s timeout on SIGINT/SIGTERM
- Startup tasks: mark stale `running` records as failed, prune old history
- LLM-based intent parsing for Telegram bot commands with fuzzy agent name resolution
- SSRF protection and response size limits on URL prefetch

## Testing

```bash
pnpm test          # 542 tests across 37 files (vitest)
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

TypeScript, Hono, Drizzle ORM, SQLite, Vercel AI SDK, Zod, Croner, Cronstrue, MCP SDK, Resend, Nodemailer, Vitest, Biome

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm build` | Compile TypeScript |
| `pnpm start` | Run compiled server |
| `pnpm test` | Run unit tests |
| `pnpm eval` | Run eval harness |
| `pnpm lint` | Check code with Biome |
| `pnpm db:push` | Push schema changes to SQLite |
| `pnpm mcp` | Start MCP server (development) |
| `pnpm mcp:start` | Start MCP server (production) |
