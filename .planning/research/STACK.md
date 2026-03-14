# Technology Stack

**Project:** Schedoodle -- Scheduled AI Agent System
**Researched:** 2026-03-14
**Overall confidence:** MEDIUM (versions based on training data up to May 2025; verify with `npm view <pkg> version` before installing)

## Recommended Stack

### Runtime & Language

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | ^22.x (LTS) | Runtime | LTS as of Oct 2024. Best LLM SDK ecosystem. Native fetch, built-in test runner as fallback, ESM-first. Use 22 over 20 for native `.env` loading (`--env-file`) eliminating dotenv dependency. | HIGH |
| TypeScript | ^5.7 | Type safety | Strict mode catches agent config errors at compile time. Every library in this stack has first-class TS support. | MEDIUM |
| tsx | ^4.19 | Dev runner | Zero-config TypeScript execution. Faster than ts-node, no tsconfig fuss for scripts. Use for dev; compile to JS for production. | MEDIUM |

### LLM Integration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `ai` (Vercel AI SDK) | ^4.x | LLM abstraction | Provider-agnostic `generateText()` and `generateObject()`. Structured output via Zod schemas is the killer feature for this project -- agents return typed results, not raw strings. The `generateObject` function handles JSON schema generation, retry on malformed output, and validation in one call. | MEDIUM |
| `@ai-sdk/anthropic` | ^1.x | Claude provider | Primary LLM provider. Claude excels at following structured output instructions. Swap to `@ai-sdk/openai` later without changing agent code. | MEDIUM |

### Database & ORM

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| better-sqlite3 | ^11.x | Database | Synchronous API (no async overhead for simple queries), zero-config, single-file database. Perfect for a personal tool. WAL mode handles concurrent reads from the API while the scheduler writes. | MEDIUM |
| drizzle-orm | ^0.38 | ORM | Type-safe queries without code generation step (unlike Prisma). SQL-like API means you think in SQL, not ORM abstractions. Schema-as-code enables easy migration generation. Lightweight -- no query engine binary like Prisma. | LOW |
| drizzle-kit | ^0.30 | Migrations | Generates SQL migrations from schema changes. `drizzle-kit push` for dev, `drizzle-kit generate` + `drizzle-kit migrate` for production. | LOW |

### Scheduling

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| node-cron | ^3.0 | Cron scheduling | Pure JS cron parser and scheduler. No Redis, no external dependencies. Runs in-process. For a single-user personal tool, this is the right complexity level. | HIGH |

### API Server

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Fastify | ^5.x | HTTP framework | Fastest mainstream Node.js framework. Built-in validation via JSON Schema (or Zod via fastify-type-provider-zod). First-class TypeScript support. Plugin architecture keeps code organized. Prefer over Express (slow, no built-in validation) and Hono (better for edge/serverless, not long-running servers). | MEDIUM |
| @fastify/cors | ^10.x | CORS | Needed when a frontend is eventually added. | LOW |

### Email

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| resend | ^4.x | Email delivery | Modern API, 100 emails/day free tier covers personal use. SDK is tiny (just HTTP calls). No SMTP configuration. React Email templates supported but not required -- plain HTML/text works fine. | LOW |

### Validation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| zod | ^3.24 | Schema validation | Used in three places: (1) agent config validation, (2) LLM structured output schemas, (3) API request validation. Single validation library for the entire stack. The Vercel AI SDK requires Zod for `generateObject()`. | MEDIUM |

### Testing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| vitest | ^3.x | Test runner | Native TypeScript, ESM-first, Jest-compatible API. Built-in mocking. Fast watch mode. The standard choice for modern TS projects. | MEDIUM |

### Logging

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| pino | ^9.x | Structured logging | JSON logging by default, which matters when debugging scheduled agents that run unattended. Extremely fast (doesn't block the event loop). `pino-pretty` for dev readability. Fastify uses pino natively. | MEDIUM |

### Dev Tooling

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @biomejs/biome | ^1.9 | Lint + format | Single tool replaces ESLint + Prettier. 100x faster. Opinionated defaults reduce config bikeshedding. If the team prefers ESLint, use `eslint` ^9 with flat config, but Biome is the simpler choice. | LOW |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Runtime | Node.js 22 | Bun | Bun's SQLite driver is built-in but better-sqlite3 compatibility and npm ecosystem maturity favor Node. Bun is viable but adds risk for no meaningful benefit here. |
| LLM SDK | Vercel AI SDK | LangChain.js | LangChain adds massive dependency weight and abstraction layers for features this project does not need (chains, vector stores, agents-as-framework). Vercel AI SDK is focused and lightweight. |
| LLM SDK | Vercel AI SDK | Direct Anthropic SDK | Works fine but locks you to one provider. Vercel AI SDK adds provider swapping and structured output for minimal overhead. |
| ORM | Drizzle | Prisma | Prisma requires a binary query engine (~15MB), has a code generation step, and its API hides SQL behind abstractions. Drizzle is SQL-like, lighter, and schema-as-code. |
| ORM | Drizzle | Kysely | Kysely is a query builder, not an ORM. No migration tooling built-in. Drizzle offers both query building and migrations. |
| ORM | Drizzle | Raw SQL | Viable for this project size but loses type safety on queries and requires manual migration tracking. |
| Scheduler | node-cron | BullMQ + Redis | Massively over-engineered for a single-user tool. Adds Redis as an infrastructure dependency. Use BullMQ if you later need distributed workers or job queues. |
| Scheduler | node-cron | Agenda.js | Requires MongoDB. Unnecessary dependency. |
| API | Fastify | Express | Express v4 has no built-in async error handling, no validation, slower. Express v5 is still finding its footing. Fastify is the modern default. |
| API | Fastify | Hono | Hono is optimized for edge/serverless. This is a long-running server with scheduled jobs. Fastify's plugin system and ecosystem (rate limiting, auth plugins) are better suited. |
| Email | Resend | Nodemailer | Nodemailer requires SMTP config and deliverability is your problem. Resend handles deliverability, provides a clean API. |
| Email | Resend | SendGrid | Heavier SDK, more complex pricing. Resend's free tier (100/day) is sufficient for personal agent results. |
| Logging | pino | winston | Winston is slower and less structured by default. Pino is the performance choice and integrates natively with Fastify. |
| Formatter | Biome | ESLint + Prettier | Two tools with overlapping concerns. ESLint flat config (v9) is better than legacy but still requires plugin installation. Biome does both in one fast binary. |

## Libraries NOT to Use

| Library | Why Not |
|---------|---------|
| LangChain.js | Enormous dependency tree, leaky abstractions, constant breaking changes. This project needs `generateText()` and `generateObject()`, not a framework. |
| dotenv | Node.js 22 has `--env-file=.env` built-in. One less dependency. If using Node 20, dotenv is fine. |
| cron (npm package) | Less maintained than node-cron. node-cron has cleaner API and better TypeScript types. |
| Sequelize | Legacy ORM, poor TypeScript support compared to Drizzle/Prisma. |
| Mongoose | MongoDB ORM. Wrong database. |
| pm2 | For production process management, use systemd or Docker instead. PM2 adds complexity without value for a single-process service. |

## Configuration Strategy

Use Node.js 22's built-in `--env-file` flag for environment variables:

```bash
# Development
node --env-file=.env -r tsx src/index.ts

# Production
node --env-file=.env dist/index.js
```

Required environment variables:
```
ANTHROPIC_API_KEY=sk-ant-...
RESEND_API_KEY=re_...
DATABASE_URL=./data/schedoodle.db
EMAIL_FROM=agents@yourdomain.com
EMAIL_TO=you@example.com
```

Validate all env vars at startup with Zod:
```typescript
import { z } from 'zod';

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  RESEND_API_KEY: z.string().startsWith('re_'),
  DATABASE_URL: z.string().default('./data/schedoodle.db'),
  EMAIL_FROM: z.string().email(),
  EMAIL_TO: z.string().email(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const env = envSchema.parse(process.env);
```

## Installation

```bash
# Core dependencies
npm install ai @ai-sdk/anthropic zod better-sqlite3 drizzle-orm node-cron fastify resend pino

# Dev dependencies
npm install -D typescript tsx drizzle-kit vitest @biomejs/biome @types/better-sqlite3 @types/node pino-pretty
```

## Version Verification Note

**IMPORTANT:** All version numbers above are based on training data (cutoff: May 2025) and should be verified before use. Run the following to check current versions:

```bash
npm view ai version
npm view @ai-sdk/anthropic version
npm view better-sqlite3 version
npm view drizzle-orm version
npm view node-cron version
npm view fastify version
npm view resend version
npm view zod version
npm view vitest version
npm view pino version
npm view typescript version
npm view tsx version
```

Use `^` (caret) ranges in package.json to get compatible updates within the major version.

## Sources

- PROJECT.md constraints (primary source for stack decisions)
- Training data knowledge of npm ecosystem (May 2025 cutoff) -- LOW-MEDIUM confidence on exact versions
- Vercel AI SDK: https://sdk.vercel.ai/docs
- Drizzle ORM: https://orm.drizzle.team
- Fastify: https://fastify.dev
- Resend: https://resend.com/docs
- Pino: https://getpino.io
- Biome: https://biomejs.dev
