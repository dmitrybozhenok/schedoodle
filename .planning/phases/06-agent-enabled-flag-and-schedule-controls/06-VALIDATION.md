---
phase: 6
slug: agent-enabled-flag-and-schedule-controls
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.0 |
| **Config file** | vitest.config.ts |
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
| 06-01-01 | 01 | 1 | AGNT-05a | unit | `pnpm vitest run tests/routes-agents.test.ts -t "enabled"` | ✅ (update existing) | ⬜ pending |
| 06-01-02 | 01 | 1 | AGNT-05b,c | unit | `pnpm vitest run tests/scheduler.test.ts -t "enabled"` | ✅ (update existing) | ⬜ pending |
| 06-01-03 | 01 | 1 | AGNT-05d | unit | `pnpm vitest run tests/scheduler.test.ts -t "disabled"` | ✅ (update existing) | ⬜ pending |
| 06-01-04 | 01 | 1 | AGNT-05e | unit | `pnpm vitest run tests/routes-agents.test.ts -t "execute"` | ✅ (update existing) | ⬜ pending |
| 06-01-05 | 01 | 1 | AGNT-05f | unit | `pnpm vitest run tests/routes-agents.test.ts -t "filter"` | ✅ (update existing) | ⬜ pending |
| 06-01-06 | 01 | 1 | AGNT-05g | unit | `pnpm vitest run tests/routes-agents.test.ts -t "nextRunAt"` | ✅ (update existing) | ⬜ pending |
| 06-01-07 | 01 | 1 | AGNT-05h | unit | `pnpm vitest run tests/routes-agents.test.ts -t "lastRunAt"` | ✅ (update existing) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Update `CREATE_AGENTS_SQL` in `tests/scheduler.test.ts` — add `enabled INTEGER NOT NULL DEFAULT 1`
- [ ] Update `CREATE_AGENTS_SQL` in `tests/routes-agents.test.ts` — add `enabled INTEGER NOT NULL DEFAULT 1`
- [ ] Update `makeAgent` helper in both test files to accept `enabled` override

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
