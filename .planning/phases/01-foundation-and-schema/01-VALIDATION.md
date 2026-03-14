---
phase: 1
slug: foundation-and-schema
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x |
| **Config file** | vitest.config.ts (Wave 0 — needs creation) |
| **Quick run command** | `pnpm vitest run` |
| **Full suite command** | `pnpm vitest run --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run`
- **After every plan wave:** Run `pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | AGNT-04 | integration | `pnpm vitest run tests/db.test.ts -t "agent"` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | SC-01 | smoke | `pnpm build && node dist/index.js` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | SC-02 | integration | `pnpm vitest run tests/db.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 1 | SC-03 | unit | `pnpm vitest run tests/config.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-05 | 01 | 1 | SC-04 | unit | `pnpm vitest run tests/db.test.ts -t "schema"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — Vitest configuration file
- [ ] `tests/config.test.ts` — env validation success and failure cases
- [ ] `tests/db.test.ts` — agent CRUD operations, schema field verification
- [ ] Framework install: `pnpm add -D vitest` — included in initial install

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Config crash with clear error | SC-03 | Output format verification | Run with missing ANTHROPIC_API_KEY, verify error message is human-readable |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
