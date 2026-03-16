---
phase: 17
slug: code-refactoring-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test && pnpm typecheck && pnpm lint`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | Constants centralization | unit | `pnpm test` | Yes | pending |
| 17-01-02 | 01 | 1 | Logger utility | unit | `pnpm test` | No — W0 | pending |
| 17-02-01 | 02 | 1 | Validation helpers extraction | unit | `pnpm test` | Yes | pending |
| 17-03-01 | 03 | 2 | Executor decomposition | unit | `pnpm test` | Yes | pending |
| 17-03-02 | 03 | 2 | Test file restructuring | unit | `pnpm test` | No — W0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/execution-orchestrator.test.ts` — stubs for orchestration logic
- [ ] `tests/execution-recorder.test.ts` — stubs for DB recording logic
- [ ] Logger tests (if logger has logic beyond pass-through)

*Existing infrastructure covers most phase requirements — Wave 0 adds test files for newly decomposed modules.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Import paths unchanged for consumers | API compatibility | Requires checking all import sites | Verify `pnpm typecheck` passes after refactoring |

*All other behaviors have automated verification via existing test suite.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
