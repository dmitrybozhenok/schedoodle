# Phase 13: CI/CD Pipeline - Research

**Researched:** 2026-03-15
**Domain:** GitHub Actions CI for Node.js/pnpm/TypeScript projects
**Confidence:** HIGH

## Summary

This phase creates a GitHub Actions CI workflow that runs lint, typecheck, test, and build checks on every push to main and on manual dispatch. The project uses pnpm as its package manager with better-sqlite3 as a native dependency, Biome for linting, TypeScript for type checking and building, and Vitest for testing. All 29 test files (422 tests) run in ~7 seconds with fully mocked external services.

The implementation is straightforward: a single workflow file with four parallel jobs, each running one check. The pnpm store cache is handled by actions/setup-node's built-in `cache: 'pnpm'` option. The project already has `onlyBuiltDependencies` configured for better-sqlite3 in package.json, which resolves the known pnpm 10 native binding compilation issue in CI.

**Primary recommendation:** Create `.github/workflows/ci.yml` with four parallel jobs (lint, typecheck, test, build) sharing the same pnpm/Node.js setup steps, using `pnpm/action-setup@v4` + `actions/setup-node@v4` with built-in pnpm caching.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- GitHub Actions as CI platform (zero setup cost, already on GitHub)
- Triggers: push to main + workflow_dispatch (manual). No PR trigger.
- No branch protection rules
- Single Node.js version: Node 20 only
- Four checks: lint (biome check), typecheck (tsc --noEmit), test (vitest run), build (tsc)
- All four run as parallel jobs for fastest feedback
- pnpm store cached between runs
- No test artifacts or JUnit reports -- log output is sufficient
- No deployment in this phase -- CI checks only
- No Dockerfile
- Dummy ANTHROPIC_API_KEY=test-key-ci in workflow env
- All tests already mock external services -- full suite runs in CI as-is
- In-memory SQLite for tests -- already handled by tests/setup.ts

### Claude's Discretion
- Exact workflow YAML structure and job naming
- pnpm version and setup action choices
- Whether typecheck is a separate job or folded into build (since tsc does both)
- Caching strategy details (hash key, restore keys)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Standard Stack

### Core

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| GitHub Actions | N/A | CI platform | Native to GitHub, free for public repos, zero setup |
| pnpm/action-setup | v4 | Install pnpm in CI | Official pnpm GitHub Action, latest stable major |
| actions/setup-node | v4 | Install Node.js + cache deps | Standard Node.js setup action with built-in pnpm cache support |
| actions/checkout | v4 | Check out repo code | Standard, latest stable major |

### Versions to Pin in Workflow

| Software | Version | Rationale |
|----------|---------|-----------|
| Node.js | 20 | User decision: single version, matches project target |
| pnpm | 10 | Matches local lockfile version 9.0 format (pnpm 10 uses lockfile v9), matches pnpm.io CI docs |
| Runner | ubuntu-latest | Ubuntu 24.04 as of 2026; has build-essential pre-installed for better-sqlite3 |

### Version Choice: actions/setup-node v4 vs v6

While `actions/setup-node@v6` exists (released March 2025), v6 changed caching defaults (limited auto-caching to npm only) and requires newer runner versions. **Recommendation: use v4** for maximum compatibility and simplicity -- the `cache: 'pnpm'` option works identically and is well-documented in the pnpm.io official CI guide. This avoids any breaking changes from v5/v6 while maintaining full pnpm caching support.

### Recommendation: Keep Typecheck as Separate Job

Although `tsc` (build) and `tsc --noEmit` (typecheck) use the same compiler, keep them as separate parallel jobs:
- `tsc --noEmit` runs faster (no output generation) and gives pure type-error feedback
- `tsc` (build) tests that output generation works (dist/ files compile correctly)
- Parallel execution means no time penalty -- both run simultaneously
- Matches the user's explicit four-job specification: lint, typecheck, test, build

## Architecture Patterns

### Recommended Project Structure

```
.github/
  workflows/
    ci.yml          # Single workflow file, four parallel jobs
```

### Pattern: Shared Setup Steps via YAML Anchors or Repeated Steps

GitHub Actions does not support YAML anchors in workflow files. Each parallel job must repeat the setup steps (checkout, pnpm install, node setup). This is the standard pattern -- the duplication is minimal (4 steps) and each job runs independently on its own runner.

```yaml
# Each job follows this identical setup pattern:
steps:
  - uses: actions/checkout@v4
  - uses: pnpm/action-setup@v4
    with:
      version: 10
  - uses: actions/setup-node@v4
    with:
      node-version: 20
      cache: 'pnpm'
  - run: pnpm install --frozen-lockfile
  # Then the actual check command
```

### Pattern: Environment Variables for Tests

```yaml
env:
  ANTHROPIC_API_KEY: test-key-ci
```

Set at the workflow level so all jobs inherit it. Tests mock all external calls, so the key is never used -- it just prevents the env validation in `tests/setup.ts` from failing (though the setup file already uses `??=` fallback).

### Anti-Patterns to Avoid

- **Single sequential job with all checks:** Wastes time when one check fails early. Parallel jobs give faster individual feedback and re-run granularity.
- **Caching node_modules directly:** Fragile with pnpm's symlink structure. Use `cache: 'pnpm'` which caches the pnpm store, not node_modules.
- **Omitting --frozen-lockfile:** Without it, pnpm may update the lockfile in CI, causing non-reproducible builds. Always use `--frozen-lockfile` in CI.
- **Installing all deps for lint-only job:** Even lint needs `pnpm install` because Biome is a devDependency installed via pnpm. But the cached pnpm store makes subsequent installs fast (~5-10s).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| pnpm installation | Shell script to download pnpm | pnpm/action-setup@v4 | Handles version pinning, PATH setup, store caching |
| Dependency caching | actions/cache with manual key computation | actions/setup-node cache: 'pnpm' | Built-in, uses pnpm-lock.yaml hash automatically |
| Node.js installation | nvm or manual download | actions/setup-node@v4 | Standard, handles version resolution and caching |

## Common Pitfalls

### Pitfall 1: better-sqlite3 Native Compilation Failure

**What goes wrong:** pnpm 10 blocks lifecycle scripts by default. better-sqlite3 requires a postinstall script to compile native bindings. CI fails with "Could not locate the bindings file."
**Why it happens:** pnpm 10 security feature blocks install scripts unless explicitly allowed.
**How to avoid:** The project already has `"onlyBuiltDependencies": ["better-sqlite3", "esbuild"]` in package.json. This is sufficient -- no additional CI configuration needed. Ubuntu runners have build-essential pre-installed.
**Warning signs:** Error mentioning "bindings" or "node-gyp" in CI logs.

### Pitfall 2: Missing pnpm-lock.yaml

**What goes wrong:** `pnpm install --frozen-lockfile` fails because lockfile is missing or not committed.
**Why it happens:** .gitignore accidentally includes it, or developer forgot to commit after adding deps.
**How to avoid:** Verified: pnpm-lock.yaml IS tracked in git. No action needed.
**Warning signs:** CI install step fails with "Lockfile is not up to date."

### Pitfall 3: Environment Variable Requirements

**What goes wrong:** Tests fail because ANTHROPIC_API_KEY is not set, causing env.ts module load to fail.
**Why it happens:** tests/setup.ts uses `process.env.ANTHROPIC_API_KEY ??= "test-key-for-module-load"` which handles the fallback. However, setting it at workflow level is belt-and-suspenders.
**How to avoid:** Set `ANTHROPIC_API_KEY: test-key-ci` in workflow env block. Also set `MAX_CONCURRENT_LLM: 3` since tests/setup.ts also defaults that.
**Warning signs:** Mysterious test failures mentioning missing env vars.

### Pitfall 4: Typecheck Succeeding Despite Build Failure

**What goes wrong:** `tsc --noEmit` passes but `tsc` (with emit) fails due to output directory issues.
**Why it happens:** `--noEmit` skips output file generation, so path/permission issues in outDir are not caught.
**How to avoid:** Running both as separate jobs catches both type errors (fast, via --noEmit) and build errors (emit to dist/).
**Warning signs:** Green typecheck but red build job.

### Pitfall 5: Cache Key Collisions Across OS

**What goes wrong:** Not applicable here (single OS), but worth noting: pnpm caches are OS-specific. The built-in `cache: 'pnpm'` handles this by including the OS in the cache key.
**How to avoid:** Use built-in caching, don't construct manual cache keys.

## Code Examples

### Complete Workflow File

```yaml
# Source: pnpm.io/continuous-integration + project-specific configuration
name: CI

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  ANTHROPIC_API_KEY: test-key-ci
  MAX_CONCURRENT_LLM: "3"

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint

  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec tsc --noEmit

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm run test

  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
```

### Key Script Mappings

| CI Job | pnpm Script | Actual Command | Expected Duration |
|--------|-------------|----------------|-------------------|
| lint | `pnpm run lint` | `biome check .` | ~2-5s |
| typecheck | `pnpm exec tsc --noEmit` | Direct tsc call | ~3-8s |
| test | `pnpm run test` | `vitest run` | ~7s (422 tests) |
| build | `pnpm run build` | `tsc` | ~5-10s |

Note: There is no `typecheck` script in package.json. Use `pnpm exec tsc --noEmit` directly, or optionally add a `"typecheck": "tsc --noEmit"` script to package.json for consistency. Either approach works.

### Branch Name Consideration

The project uses `master` as the default branch (verified from git status). The workflow trigger should use `master`, not `main`:

```yaml
on:
  push:
    branches: [master]  # NOT main -- project uses master
  workflow_dispatch:
```

This is a critical detail -- the CONTEXT.md says "push to main" but the actual default branch is `master`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pnpm/action-setup@v2 | pnpm/action-setup@v4 | 2024 | v2 broken with newer Node.js |
| Manual actions/cache for pnpm | setup-node cache: 'pnpm' | 2021+ | Zero-config caching |
| ubuntu-22.04 | ubuntu-latest (24.04) | Jan 2025 | Newer toolchain, no action needed |
| pnpm auto-runs scripts | pnpm 10 blocks scripts by default | Jan 2025 | Requires onlyBuiltDependencies (already configured) |
| actions/setup-node@v4 | actions/setup-node@v6 available | Mar 2025 | v6 changes caching defaults; v4 still works and is simpler |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm run test` |
| Full suite command | `pnpm run test` (same -- all 422 tests run in ~7s) |

### Phase Requirements -> Test Map

This phase has no formal requirement IDs (TBD in REQUIREMENTS.md). The validation is:

| Behavior | Test Type | Automated Command | File Exists? |
|----------|-----------|-------------------|-------------|
| Workflow file is valid YAML | smoke | Push to master and observe GitHub Actions tab | N/A (GitHub validates) |
| Lint job passes | smoke | `pnpm run lint` | N/A (existing infrastructure) |
| Typecheck job passes | smoke | `pnpm exec tsc --noEmit` | N/A (existing infrastructure) |
| Test job passes | smoke | `pnpm run test` | 29 test files exist |
| Build job passes | smoke | `pnpm run build` | N/A (existing infrastructure) |

### Sampling Rate
- **Per task commit:** `pnpm run lint && pnpm exec tsc --noEmit && pnpm run test && pnpm run build`
- **Per wave merge:** Same (all four checks)
- **Phase gate:** Push to master, verify all four jobs green in GitHub Actions

### Wave 0 Gaps
None -- existing test and build infrastructure covers all CI checks. The only new file is the workflow YAML itself.

## Open Questions

1. **Branch name: master vs main**
   - What we know: The repo uses `master` as the default branch. The CONTEXT.md says "push to main."
   - What's unclear: Whether the user intends to rename the branch to `main`.
   - Recommendation: Use `master` in the workflow since that is the actual branch name. The planner should note this discrepancy.

2. **Add typecheck script to package.json?**
   - What we know: There is no `typecheck` script in package.json. The CI job needs `tsc --noEmit`.
   - What's unclear: Whether to add a script for consistency or call tsc directly.
   - Recommendation: Add `"typecheck": "tsc --noEmit"` to package.json scripts for consistency with the other CI commands. This way all four CI commands map to `pnpm run <script>`.

3. **pnpm version pinning: 10 vs exact**
   - What we know: pnpm/action-setup accepts `version: 10` (latest 10.x) or exact like `10.32.1`.
   - What's unclear: Whether exact pinning matters for reproducibility.
   - Recommendation: Use `version: 10` (major only). The lockfile ensures dependency reproducibility. Exact pnpm version rarely matters.

## Sources

### Primary (HIGH confidence)
- [pnpm.io/continuous-integration](https://pnpm.io/continuous-integration) -- Official pnpm CI documentation with GitHub Actions example
- [pnpm/action-setup](https://github.com/pnpm/action-setup) -- Official action repo, confirmed v4.4.0 latest with version/cache inputs
- [actions/setup-node releases](https://github.com/actions/setup-node/releases) -- Confirmed v4 still valid, v6 available but not required
- Local project verification: package.json, tsconfig.json, vitest.config.ts, tests/setup.ts, biome.json, .gitignore, pnpm-lock.yaml

### Secondary (MEDIUM confidence)
- [better-sqlite3 pnpm 10 issue #1378](https://github.com/WiseLibs/better-sqlite3/issues/1378) -- Confirmed onlyBuiltDependencies fix (already applied in project)
- [actions/runner-images #10636](https://github.com/actions/runner-images/issues/10636) -- ubuntu-latest now Ubuntu 24.04

### Tertiary (LOW confidence)
- None -- all findings verified against official sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- pnpm.io official docs provide exact workflow pattern
- Architecture: HIGH -- simple four-job parallel pattern, well-documented
- Pitfalls: HIGH -- verified better-sqlite3 fix already in place, env vars confirmed via source

**Research date:** 2026-03-15
**Valid until:** 2026-06-15 (stable domain, GitHub Actions actions rarely break within major versions)
