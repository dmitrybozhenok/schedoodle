---
phase: 3
slug: management-api-and-scheduling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 |
| **Config file** | vitest.config.ts (exists from Phase 1) |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | AGNT-01 | integration | `pnpm vitest run tests/routes-agents.test.ts -t "create"` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | AGNT-02 | integration | `pnpm vitest run tests/routes-agents.test.ts -t "list\|get\|update\|delete"` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | AGNT-03 | integration | `pnpm vitest run tests/routes-agents.test.ts -t "system prompt"` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | SCHD-01 | unit | `pnpm vitest run tests/scheduler.test.ts -t "schedule"` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | SCHD-02 | unit | `pnpm vitest run tests/scheduler.test.ts -t "concurrent"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/routes-agents.test.ts` — covers AGNT-01, AGNT-02, AGNT-03 (Hono app.request for HTTP-level tests)
- [ ] `tests/scheduler.test.ts` — covers SCHD-01, SCHD-02 (mock executeAgent, use croner with fast schedules)
- [ ] `tests/helpers/test-db.ts` — shared in-memory SQLite setup for route tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cron fires at correct wall-clock time | SCHD-01 | Real cron timing requires waiting | Create agent with `*/1 * * * *`, wait 60s, check execution_history |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
