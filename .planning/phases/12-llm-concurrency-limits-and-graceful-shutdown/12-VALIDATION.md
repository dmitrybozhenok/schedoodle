---
phase: 12
slug: llm-concurrency-limits-and-graceful-shutdown
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 12 — Validation Strategy

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
| 12-01-01 | 01 | 1 | CONC-01, CONC-03 | unit | `pnpm vitest run tests/semaphore.test.ts` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | CONC-02, OBSV-03 | unit | `pnpm vitest run tests/executor.test.ts` | ✅ (extend) | ⬜ pending |
| 12-02-01 | 02 | 1 | SHUT-01, SHUT-02, SHUT-03 | unit | `pnpm vitest run tests/shutdown.test.ts` | ❌ W0 | ⬜ pending |
| 12-02-02 | 02 | 1 | OBSV-01, OBSV-02 | unit | `pnpm vitest run tests/health.test.ts` | ✅ (extend) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/semaphore.test.ts` — stubs for CONC-01, CONC-03 (semaphore limit + FIFO ordering)
- [ ] `tests/shutdown.test.ts` — stubs for SHUT-01, SHUT-02, SHUT-03 (drain, timeout, stale marking)
- [ ] Extend `tests/executor.test.ts` — CONC-02 (semaphore wrapping), OBSV-03 (queue logging)
- [ ] Extend `tests/health.test.ts` — OBSV-01 (concurrency stats), OBSV-02 (503 on shutdown)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real SIGINT/SIGTERM shutdown | SHUT-01 | Signal handling requires process-level testing | Start server, trigger agent, send SIGINT, verify log output and clean exit |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
