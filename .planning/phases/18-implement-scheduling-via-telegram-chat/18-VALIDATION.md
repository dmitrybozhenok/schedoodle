---
phase: 18
slug: implement-scheduling-via-telegram-chat
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test -- --reporter=verbose` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~9 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | TGSCHED-01 | unit | `pnpm test -- tests/intent-parser.test.ts` | ✅ | ⬜ pending |
| 18-01-02 | 01 | 1 | TGSCHED-02 | unit | `pnpm test -- tests/intent-parser.test.ts` | ✅ | ⬜ pending |
| 18-02-01 | 02 | 2 | TGSCHED-03 | unit | `pnpm test -- tests/telegram-commands.test.ts` | ✅ | ⬜ pending |
| 18-02-02 | 02 | 2 | TGSCHED-04 | unit | `pnpm test -- tests/telegram-commands.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — tests/telegram-commands.test.ts and tests/intent-parser.test.ts already exist.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Telegram bot responds to create/delete messages | TGSCHED-01 | Requires live Telegram Bot API | Send "create Test Agent that runs hourly and says hello" via Telegram |
| Pending deletion timeout expires | TGSCHED-03 | Timing-dependent behavior | Wait 60s after "delete X" without confirming |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
