# Phase 13: CI/CD Pipeline - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Automated CI pipeline that runs lint, typecheck, test, and build checks on every push to main and on manual dispatch. No deployment — CI checks only for now.

</domain>

<decisions>
## Implementation Decisions

### CI Platform & Triggers
- GitHub Actions — already on GitHub, zero setup cost
- Triggers: push to main + workflow_dispatch (manual)
- No PR trigger — sole developer, direct pushes to main
- No branch protection rules — keep friction low
- Single Node.js version: Node 20 only

### Pipeline Stages
- Four checks: lint (biome check), typecheck (tsc --noEmit), test (vitest run), build (tsc)
- All four run as parallel jobs for fastest feedback
- pnpm store cached between runs for faster installs
- No test artifacts or JUnit reports — log output is sufficient

### Deployment
- No deployment in this phase — CI checks only
- No Dockerfile — add when deployment is needed

### Secret & Env Handling
- Dummy ANTHROPIC_API_KEY=test-key-ci in workflow env — tests mock LLM calls, key is never used
- All tests already mock external services (LLM, email, Brave Search, HTTP) — full suite runs in CI as-is
- In-memory SQLite for tests — already handled by tests/setup.ts, works out of the box
- pnpm install handles better-sqlite3 native compilation — Ubuntu runners have build tools pre-installed

### Claude's Discretion
- Exact workflow YAML structure and job naming
- pnpm version and setup action choices
- Whether typecheck is a separate job or folded into build (since tsc does both)
- Caching strategy details (hash key, restore keys)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard GitHub Actions patterns for Node.js/pnpm projects.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `package.json` scripts: `lint`, `test`, `build` already defined and working
- `vitest.config.ts`: configured with globals, node environment, setup file
- `tests/setup.ts`: handles env var injection and in-memory DB setup
- `biome.json` (implied by biome dependency): linting/formatting config

### Established Patterns
- pnpm as package manager (onlyBuiltDependencies configured for better-sqlite3)
- TypeScript strict mode with ES2022 target, NodeNext module resolution
- All 29 test files mock external dependencies — no real API calls

### Integration Points
- `.github/workflows/` directory (new — doesn't exist yet)
- `package.json` scripts are the interface between CI and the codebase

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-ci-cd-pipeline*
*Context gathered: 2026-03-15*
