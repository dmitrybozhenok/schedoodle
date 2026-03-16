---
phase: 16
slug: telegram-nlp-control
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test --reporter=verbose` |
| **Full suite command** | `pnpm test --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test --reporter=verbose`
- **After every plan wave:** Run `pnpm test --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | TGCTL-01 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 16-01-02 | 01 | 1 | TGCTL-03, TGCTL-04, TGCTL-11 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 16-01-03 | 01 | 1 | TGCTL-02 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 16-01-04 | 01 | 1 | TGCTL-10 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 16-02-01 | 02 | 2 | TGCTL-05, TGCTL-06, TGCTL-07, TGCTL-08, TGCTL-09, TGCTL-12 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 16-02-02 | 02 | 2 | TGCTL-01 | integration | `pnpm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/telegram-bot.test.ts` — stubs for TGCTL-01 through TGCTL-12
- [ ] Test helpers for mocking Telegram Bot API responses and LLM intent parsing

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Telegram bot receives real messages | TGCTL-01 | Requires live Telegram bot | Send messages to bot, verify responses |
| Fuzzy agent name resolution accuracy | TGCTL-04 | LLM output varies | Test with various phrasings against real agents |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
