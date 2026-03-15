---
phase: 8
slug: enhanced-health-monitoring-with-agent-health-flags-and-execution-diagnostics
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.0 |
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
| 08-01-01 | 01 | 1 | P8-01 | unit | `pnpm exec vitest run tests/health.test.ts -t "per-agent"` | Needs update | ⬜ pending |
| 08-01-02 | 01 | 1 | P8-02 | unit | `pnpm exec vitest run tests/helpers-enrich-agent.test.ts -t "healthy"` | Needs update | ⬜ pending |
| 08-01-03 | 01 | 1 | P8-03 | unit | `pnpm exec vitest run tests/helpers-enrich-agent.test.ts -t "recover"` | Needs update | ⬜ pending |
| 08-01-04 | 01 | 1 | P8-04 | unit | `pnpm exec vitest run tests/health.test.ts -t "status"` | Needs update | ⬜ pending |
| 08-01-05 | 01 | 1 | P8-05 | unit | `pnpm exec vitest run tests/health.test.ts -t "upcoming"` | Needs update | ⬜ pending |
| 08-01-06 | 01 | 1 | P8-06 | unit | `pnpm exec vitest run tests/executor.test.ts -t "retryCount"` | Needs update | ⬜ pending |
| 08-01-07 | 01 | 1 | P8-07 | unit | `pnpm exec vitest run tests/routes-agents.test.ts -t "limit"` | Needs update | ⬜ pending |
| 08-01-08 | 01 | 1 | P8-08 | unit | `pnpm exec vitest run tests/health.test.ts -t "aggregate"` | Needs update | ⬜ pending |
| 08-01-09 | 01 | 1 | P8-09 | unit | `pnpm exec vitest run tests/helpers-enrich-agent.test.ts -t "enrichAgent"` | Needs update | ⬜ pending |
| 08-01-10 | 01 | 1 | P8-10 | unit | `pnpm exec vitest run tests/health.test.ts -t "truncat"` | Needs update | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/health.test.ts` — update inline CREATE TABLE SQL for retry_count column; add test stubs for per-agent breakdown, upcoming runs, status levels, aggregates, truncation
- [ ] `tests/helpers-enrich-agent.test.ts` — add test stubs for healthy flag, consecutiveFailures, auto-recovery
- [ ] `tests/executor.test.ts` — add test stubs for retryCount recording
- [ ] `tests/routes-agents.test.ts` — add test stub for default limit change to 100
- [ ] `tests/db.test.ts` — update inline CREATE TABLE SQL for retry_count column

*All test files use inline CREATE TABLE SQL (not schema.ts), so they must be updated to include the new `retry_count` column.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
