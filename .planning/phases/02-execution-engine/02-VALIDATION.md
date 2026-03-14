---
phase: 2
slug: execution-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 2 — Validation Strategy

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
| 02-01-01 | 01 | 1 | EXEC-01 | unit (mocked LLM) | `pnpm vitest run tests/executor.test.ts -t "executes agent"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | EXEC-02 | unit (mocked LLM) | `pnpm vitest run tests/executor.test.ts -t "validation"` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | EXEC-03 | unit | `pnpm vitest run tests/executor.test.ts -t "failure isolation"` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | EXEC-04 | unit (mocked fetch) | `pnpm vitest run tests/prefetch.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/executor.test.ts` — covers EXEC-01, EXEC-02, EXEC-03 (mock AI SDK, mock DB)
- [ ] `tests/prefetch.test.ts` — covers EXEC-04 (mock global fetch)
- [ ] `tests/schemas.test.ts` — covers output schema validation edge cases
- [ ] AI SDK mocking pattern: vi.mock("ai") to intercept generateText calls without hitting real API

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real LLM structured response | EXEC-01 | Requires actual API key and network | Run `pnpm dev`, execute agent, verify JSON result in DB |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
