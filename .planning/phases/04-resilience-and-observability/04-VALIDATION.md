---
phase: 4
slug: resilience-and-observability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 4 — Validation Strategy

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
| 04-01-01 | 01 | 1 | RSLN-01 | unit | `pnpm vitest run tests/circuit-breaker.test.ts -t "trips"` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | RSLN-02 | unit | `pnpm vitest run tests/circuit-breaker.test.ts -t "half-open"` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | OBSV-01 | unit | `pnpm vitest run tests/pricing.test.ts -t "cost"` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | OBSV-01 | unit | `pnpm vitest run tests/executor.test.ts -t "cost"` | Extend | ⬜ pending |
| 04-02-02 | 02 | 2 | OBSV-02 | unit | `pnpm vitest run tests/health.test.ts -t "health"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/circuit-breaker.test.ts` — covers RSLN-01, RSLN-02 (state transitions, trip threshold, auto-recovery)
- [ ] `tests/pricing.test.ts` — covers OBSV-01 (cost computation for known/unknown models)
- [ ] `tests/health.test.ts` — covers OBSV-02 (health endpoint response shape)
- [ ] Extend `tests/executor.test.ts` — add cost recording assertions

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Circuit breaker trips with real Anthropic outage | RSLN-01 | Requires actual API failure | Temporarily use invalid API key, trigger 3 agent executions, verify fast-fail |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
