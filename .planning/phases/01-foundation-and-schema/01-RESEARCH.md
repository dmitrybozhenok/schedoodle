# Phase 1: Foundation and Schema - Research

**Researched:** 2026-03-14
**Domain:** TypeScript project scaffold, SQLite with Drizzle ORM, environment config validation
**Confidence:** HIGH

## Summary

Phase 1 is a greenfield TypeScript project scaffold with SQLite persistence via Drizzle ORM and Zod-based environment validation. All technologies in this phase are mature, well-documented, and have clear standard patterns. The primary decisions (ESM, Drizzle, better-sqlite3, Biome, Zod) are locked by user context. The main discretionary choices are: using `drizzle-kit push` for local development (simpler than generate/migrate for a solo project), tsx for dev runner, and pnpm as package manager.

This phase produces the foundation every subsequent phase imports: the database connection, schema types, and config module. Getting the project structure and patterns right here prevents rework later.

**Primary recommendation:** Use `drizzle-kit push` for schema management (no migration files needed for a personal tool), Zod for env validation with fail-fast behavior, and Biome for formatting/linting from the start.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Auto-increment integer primary key for DB relations
- Agent name is a separate display field, must be unique (case-insensitive)
- Freeform text names allowed ("Morning Briefing", "dep-watch", etc.)
- No enabled/disabled status field -- deferred to v2 (AGNT-05)
- Include created_at and updated_at timestamp columns
- Track input_tokens and output_tokens separately (different pricing per direction)
- Store full LLM result as JSON column
- Status enum: success / failure / running (three states)
- Error details in a separate error column
- Keep all history, no retention limit
- Crash with clear error on missing required config -- fail fast
- Config from .env file (dotenv) with environment variable overrides
- Phase 1 validates: DATABASE_URL (or path) and ANTHROPIC_API_KEY only
- Database path has a sensible default (e.g., ./data/schedoodle.db), overridable via env
- Organize by layer: src/config/, src/db/, src/services/, src/types/, src/index.ts
- ESM modules ("type": "module" in package.json)
- Biome for linting and formatting from day one

### Claude's Discretion
- Dev runner choice (tsx watch vs alternatives)
- Exact Drizzle migration workflow
- Database column types and constraints beyond what's specified
- tsconfig settings
- Package manager choice

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGNT-04 | Agent definitions are persisted in the database | Drizzle ORM schema with SQLite/better-sqlite3; agents table with all specified columns; execution_history table with observability fields |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| typescript | ~5.7 | Type system | Required by project constraints |
| drizzle-orm | 0.45.x | Type-safe ORM | Locked decision; SQLite support, schema-as-code |
| better-sqlite3 | 11.x | SQLite driver | Locked decision; synchronous, fast, zero-config |
| zod | 3.24.x | Schema validation | Config validation, future LLM output schemas |
| dotenv | 16.x | .env file loading | Locked decision; env var loading |

### Dev Dependencies
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| drizzle-kit | latest | Schema push/migration CLI | Schema changes |
| @types/better-sqlite3 | latest | Type definitions | TypeScript compilation |
| tsx | 4.x | TypeScript execution + watch | Development runner |
| @biomejs/biome | 2.x | Linting + formatting | All code changes |
| vitest | 3.x | Test framework | Phase validation tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsx | node --loader ts-node/esm | tsx is faster, zero-config for ESM |
| drizzle-kit push | drizzle-kit generate + migrate | Push is simpler for solo dev; generate/migrate adds tracked SQL files |
| pnpm | npm | pnpm is faster, stricter; npm is more common |

### Discretion Recommendations

**Dev runner:** Use `tsx` with `--watch` flag. It is built on esbuild, handles ESM natively, and is the current standard for TypeScript Node.js development. No configuration needed.

**Migration workflow:** Use `drizzle-kit push` for development. This directly syncs your TypeScript schema to the database without generating migration SQL files. For a personal tool with a single SQLite file, this is the right tradeoff -- simpler workflow, no migration folder to manage.

**Package manager:** Use `pnpm`. Faster installs, strict dependency resolution, and disk-efficient. If the user prefers npm, everything works the same.

**tsconfig:** Target ES2022, module NodeNext, moduleResolution NodeNext, strict mode enabled.

**Installation:**
```bash
pnpm init
pnpm add drizzle-orm better-sqlite3 zod dotenv
pnpm add -D drizzle-kit @types/better-sqlite3 typescript tsx @biomejs/biome vitest @types/node
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  config/
    env.ts           # Zod schema, dotenv loading, fail-fast validation
  db/
    index.ts         # Drizzle client creation + export
    schema.ts        # All Drizzle table definitions
  services/          # (empty for Phase 1, used from Phase 2+)
  types/
    index.ts         # Shared type exports derived from schema
  index.ts           # Entry point -- loads config, connects DB, logs startup
drizzle.config.ts    # Drizzle Kit configuration
biome.json           # Biome linter/formatter config
tsconfig.json
package.json
.env.example         # Documented env vars
tests/
  config.test.ts     # Config validation tests
  db.test.ts         # Schema and CRUD tests
```

### Pattern 1: Zod Environment Validation with Fail-Fast
**What:** Define a Zod schema for all required env vars, parse process.env at startup, crash with descriptive errors on failure.
**When to use:** Always -- this is the config entry point.
**Example:**
```typescript
// src/config/env.ts
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().default('./data/schedoodle.db'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
```

### Pattern 2: Drizzle Schema Definition with SQLite Types
**What:** Define tables using Drizzle's SQLite column helpers, export inferred types.
**When to use:** All database table definitions.
**Example:**
```typescript
// src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const agents = sqliteTable('agents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  taskDescription: text('task_description').notNull(),
  cronSchedule: text('cron_schedule').notNull(),
  systemPrompt: text('system_prompt'),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updated_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const executionHistory = sqliteTable('execution_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: integer('agent_id').notNull().references(() => agents.id),
  status: text('status', { enum: ['success', 'failure', 'running'] }).notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  durationMs: integer('duration_ms'),
  result: text('result', { mode: 'json' }),
  error: text('error'),
  deliveryStatus: text('delivery_status'),
  startedAt: text('started_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
  completedAt: text('completed_at'),
});
```

### Pattern 3: Drizzle Client Export
**What:** Single module that creates and exports the database connection.
**When to use:** Imported by all modules that need DB access.
**Example:**
```typescript
// src/db/index.ts
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { env } from '../config/env.js';

export const db = drizzle(env.DATABASE_URL, { schema });
export type Database = typeof db;
```

### Pattern 4: Type Inference from Schema
**What:** Derive TypeScript types from Drizzle schema using `$inferSelect` and `$inferInsert`.
**When to use:** Whenever you need agent or execution types in service/handler code.
**Example:**
```typescript
// src/types/index.ts
import type { agents, executionHistory } from '../db/schema.js';

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Execution = typeof executionHistory.$inferSelect;
export type NewExecution = typeof executionHistory.$inferInsert;
```

### Anti-Patterns to Avoid
- **Hand-writing SQL types:** Never define TypeScript interfaces for DB rows manually. Use `$inferSelect` / `$inferInsert` from Drizzle schema -- they stay in sync automatically.
- **Lazy env validation:** Never use `process.env.X!` with non-null assertions. Always validate through the Zod config module.
- **Timestamps as integer:** Use `text` with `CURRENT_TIMESTAMP` default for SQLite timestamps. SQLite does not have a native datetime type; text ISO strings are the standard approach.
- **Missing .js extensions in ESM imports:** With NodeNext module resolution, all relative imports MUST include `.js` extension (even for .ts files). This is a common source of runtime errors.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL query building | String concatenation | Drizzle query builder | SQL injection, type safety |
| Schema types | Manual TypeScript interfaces | Drizzle `$inferSelect`/`$inferInsert` | Single source of truth, auto-sync |
| Env validation | Manual checks with if/throw | Zod schema parse | Composable, typed, clear error messages |
| Code formatting | Manual style rules | Biome | Consistent, fast, zero-config |
| File watching | nodemon + ts-node | tsx --watch | Simpler, faster, ESM-native |

**Key insight:** This phase is about setting up the foundation correctly so future phases never need to think about database types, config loading, or project structure again. Every hand-rolled solution here becomes technical debt that multiplies across 4 subsequent phases.

## Common Pitfalls

### Pitfall 1: ESM Import Extensions
**What goes wrong:** Runtime "Cannot find module" errors when imports lack `.js` extension.
**Why it happens:** TypeScript compiles `.ts` to `.js` but does not rewrite import specifiers. Node.js ESM requires explicit extensions.
**How to avoid:** Always use `.js` extensions in relative imports: `import { db } from './db/index.js'`
**Warning signs:** Build succeeds but runtime crashes with ERR_MODULE_NOT_FOUND.

### Pitfall 2: SQLite Case-Insensitive Uniqueness
**What goes wrong:** User creates agents "MyAgent" and "myagent" as separate entries.
**Why it happens:** SQLite's UNIQUE constraint is case-sensitive by default.
**How to avoid:** Use `COLLATE NOCASE` on the name column: `text('name').notNull().unique()` combined with a check at the application level, or define the column with a raw SQL default. In Drizzle, the simplest approach is to add a unique index with `sql\`COLLATE NOCASE\`` or normalize to lowercase before insert.
**Warning signs:** Duplicate agent names that differ only in casing.

### Pitfall 3: Drizzle Push vs Generate Confusion
**What goes wrong:** Developer runs `drizzle-kit push` in production expecting tracked migrations.
**Why it happens:** `push` applies changes directly without SQL files; `generate` + `migrate` creates tracked migration history.
**How to avoid:** For this project (personal tool, single SQLite file), `push` is fine. Document the choice so future phases know.
**Warning signs:** N/A for this project.

### Pitfall 4: dotenv Not Loading Before Zod Parse
**What goes wrong:** Zod validation fails because env vars are not yet loaded from .env file.
**Why it happens:** `dotenv` must be imported before accessing `process.env`.
**How to avoid:** Use `import 'dotenv/config'` as the first import in the config module. This side-effect import loads .env immediately.
**Warning signs:** All env vars show as undefined despite correct .env file.

### Pitfall 5: SQLite WAL Mode for Concurrent Access
**What goes wrong:** Database locks during concurrent reads/writes in later phases.
**Why it happens:** SQLite default journal mode blocks concurrent access.
**How to avoid:** Enable WAL mode at connection time: `PRAGMA journal_mode=WAL`. better-sqlite3 supports this via `db.pragma('journal_mode = WAL')`.
**Warning signs:** SQLITE_BUSY errors during scheduling phase.

### Pitfall 6: Data Directory Not Existing
**What goes wrong:** better-sqlite3 throws ENOENT when opening `./data/schedoodle.db` if `./data/` does not exist.
**Why it happens:** better-sqlite3 creates the .db file but not parent directories.
**How to avoid:** Ensure the data directory exists before creating the database connection (use `mkdirSync` with `{ recursive: true }`).
**Warning signs:** ENOENT error on first run.

## Code Examples

### drizzle.config.ts
```typescript
// Source: https://orm.drizzle.team/docs/drizzle-kit-push
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  dbCredentials: {
    url: process.env.DATABASE_URL || './data/schedoodle.db',
  },
});
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### biome.json
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  }
}
```

### package.json scripts
```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### Entry Point Pattern
```typescript
// src/index.ts
import { env } from './config/env.js';
import { db } from './db/index.js';
import { agents } from './db/schema.js';

async function main() {
  console.log('Schedoodle starting...');
  console.log(`Database: ${env.DATABASE_URL}`);

  // Verify DB connection by counting agents
  const result = db.select().from(agents).all();
  console.log(`Loaded ${result.length} agents`);

  console.log('Schedoodle ready.');
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ts-node + nodemon | tsx --watch | 2023-2024 | Faster startup, native ESM, zero config |
| ESLint + Prettier | Biome | 2024-2025 | Single tool, 10-15x faster, less config |
| Knex/Sequelize | Drizzle ORM | 2023-2024 | Schema-as-code, type inference, lighter weight |
| Manual env checks | Zod env validation | 2023+ | Type-safe config, composable schemas |
| CommonJS | ESM (type: module) | 2022+ | Standard module system, better tree-shaking |

**Deprecated/outdated:**
- ts-node: Compatibility issues with ESM in Node 20+; tsx is the replacement
- Prisma for SQLite: Heavier, requires code generation step; Drizzle is lighter
- dotenv.config() call: Use `import 'dotenv/config'` side-effect import instead

## Open Questions

1. **Biome indent style**
   - What we know: Biome defaults to tabs; many projects use spaces
   - What's unclear: User preference for indent style
   - Recommendation: Default to tabs (Biome default); trivially changed in biome.json

2. **SQLite COLLATE NOCASE in Drizzle**
   - What we know: User wants case-insensitive unique agent names. SQLite supports COLLATE NOCASE but Drizzle may not expose it declaratively on column definitions.
   - What's unclear: Whether Drizzle's column builder supports collation directly
   - Recommendation: Use a raw SQL unique index with COLLATE NOCASE, or normalize names to lowercase before insert. Test during implementation.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | vitest.config.ts (Wave 0 -- needs creation) |
| Quick run command | `pnpm vitest run` |
| Full suite command | `pnpm vitest run --coverage` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGNT-04 | Agent definitions persist in DB | integration | `pnpm vitest run tests/db.test.ts -t "agent"` | No -- Wave 0 |
| SC-01 | Project builds and runs | smoke | `pnpm build && node dist/index.js` | No -- Wave 0 |
| SC-02 | Agent CRUD in SQLite | integration | `pnpm vitest run tests/db.test.ts` | No -- Wave 0 |
| SC-03 | Config validates at startup | unit | `pnpm vitest run tests/config.test.ts` | No -- Wave 0 |
| SC-04 | Schema includes all observability fields | unit | `pnpm vitest run tests/db.test.ts -t "schema"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run`
- **Per wave merge:** `pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- Vitest configuration file
- [ ] `tests/config.test.ts` -- env validation success and failure cases
- [ ] `tests/db.test.ts` -- agent CRUD operations, schema field verification
- [ ] Framework install: `pnpm add -D vitest` -- included in initial install

## Sources

### Primary (HIGH confidence)
- [Drizzle ORM - SQLite Setup](https://orm.drizzle.team/docs/get-started-sqlite) -- driver init, installation
- [Drizzle ORM - SQLite Column Types](https://orm.drizzle.team/docs/column-types/sqlite) -- column definitions, modes
- [Drizzle ORM - Push](https://orm.drizzle.team/docs/drizzle-kit-push) -- push workflow, config format
- [Drizzle ORM - Migrations](https://orm.drizzle.team/docs/migrations) -- migration options, programmatic migrate
- [Biome.js](https://biomejs.dev/) -- formatter/linter setup
- [tsx.is](https://tsx.is/) -- TypeScript execution, watch mode

### Secondary (MEDIUM confidence)
- [Zod env validation patterns](https://www.creatures.sh/blog/env-type-safety-and-validation/) -- validated against multiple blog sources
- [Better Stack - Drizzle guide](https://betterstack.com/community/guides/scaling-nodejs/drizzle-orm/) -- setup patterns
- [Dev.to - Modern Node.js + TypeScript 2025](https://dev.to/woovi/a-modern-nodejs-typescript-setup-for-2025-nlk) -- project structure patterns

### Tertiary (LOW confidence)
- drizzle-orm npm version (0.45.x) -- version may have incremented; verify at install time

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries are locked decisions with official docs verified
- Architecture: HIGH -- patterns are standard Drizzle + Zod + ESM, verified against official sources
- Pitfalls: HIGH -- ESM extension, dotenv loading order, and SQLite WAL are well-documented issues

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable technologies, slow-moving)
