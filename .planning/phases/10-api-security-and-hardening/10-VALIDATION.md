---
phase: 10
slug: api-security-and-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run tests/{file}.test.ts` |
| **Full suite command** | `pnpm vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run tests/middleware-auth.test.ts tests/ssrf.test.ts tests/middleware-rate-limiter.test.ts tests/middleware-security.test.ts`
- **After every plan wave:** Run `pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | SEC-01 | unit | `pnpm vitest run tests/middleware-auth.test.ts -t "blocks"` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | SEC-02 | unit | `pnpm vitest run tests/middleware-auth.test.ts -t "skips"` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | SEC-07 | unit | `pnpm vitest run tests/middleware-security.test.ts -t "headers"` | ❌ W0 | ⬜ pending |
| 10-01-04 | 01 | 1 | SEC-08 | unit | `pnpm vitest run tests/middleware-security.test.ts -t "cors"` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | SEC-03 | unit | `pnpm vitest run tests/ssrf.test.ts` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 1 | SEC-04 | unit | `pnpm vitest run tests/prefetch.test.ts -t "size limit"` | ❌ W0 | ⬜ pending |
| 10-03-01 | 03 | 1 | SEC-05 | unit | `pnpm vitest run tests/schemas.test.ts -t "max"` | ❌ W0 | ⬜ pending |
| 10-04-01 | 04 | 1 | SEC-06 | unit | `pnpm vitest run tests/middleware-rate-limiter.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/middleware-auth.test.ts` — stubs for SEC-01, SEC-02
- [ ] `tests/ssrf.test.ts` — stubs for SEC-03 (isPrivateUrl function)
- [ ] `tests/middleware-rate-limiter.test.ts` — stubs for SEC-06
- [ ] `tests/middleware-security.test.ts` — stubs for SEC-07, SEC-08
- [ ] Additional test cases in existing `tests/prefetch.test.ts` — stubs for SEC-04
- [ ] Additional test cases in existing `tests/schemas.test.ts` — stubs for SEC-05

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | — | — | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
