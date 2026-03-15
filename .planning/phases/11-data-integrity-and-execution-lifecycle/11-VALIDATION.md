---
phase: 11
slug: data-integrity-and-execution-lifecycle
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.0 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | INDEX-01 | unit | `pnpm vitest run tests/db.test.ts -t "index"` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | ENV-01 | unit | `pnpm vitest run tests/config.test.ts -t "RETENTION"` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 1 | STARTUP-01 | unit | `pnpm vitest run tests/startup.test.ts -t "stale"` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 1 | STARTUP-02 | unit | `pnpm vitest run tests/startup.test.ts -t "prune"` | ❌ W0 | ⬜ pending |
| 11-03-01 | 03 | 1 | EXEC-05-guard | unit | `pnpm vitest run tests/routes-agents.test.ts -t "409"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/startup.test.ts` — stubs for STARTUP-01, STARTUP-02 (stale cleanup + pruning)
- [ ] Update `tests/routes-agents.test.ts` — change disabled agent execute test to expect 409
- [ ] Update `tests/db.test.ts` — add index existence verification tests
- [ ] Update `tests/config.test.ts` — add RETENTION_DAYS env var tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| db:push applies indexes correctly | INDEX-01 | Drizzle-kit push behavior varies | Run `pnpm db:push` in dev, verify no table recreation prompts |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
