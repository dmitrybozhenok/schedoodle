---
phase: 15
slug: telegram-notification-channel
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest v4.1.0 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm vitest run tests/telegram.test.ts tests/notifier.test.ts` |
| **Full suite command** | `pnpm vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run`
- **After every plan wave:** Run `pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | TLG-01 | unit | `pnpm vitest run tests/telegram.test.ts` | ❌ W0 | ⬜ pending |
| 15-01-02 | 01 | 1 | TLG-02 | unit | `pnpm vitest run tests/notifier.test.ts -t "Telegram"` | ❌ W0 | ⬜ pending |
| 15-01-03 | 01 | 1 | TLG-03 | unit | `pnpm vitest run tests/notifier.test.ts -t "truncat"` | ❌ W0 | ⬜ pending |
| 15-02-01 | 02 | 2 | TLG-04 | unit | `pnpm vitest run tests/executor.test.ts -t "delivery"` | Partial | ⬜ pending |
| 15-02-02 | 02 | 2 | TLG-05 | unit | `pnpm vitest run tests/health.test.ts` | Partial | ⬜ pending |
| 15-02-03 | 02 | 2 | TLG-06 | unit | `pnpm vitest run tests/mcp-telegram.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/telegram.test.ts` — escapeMdV2, sendTelegramMessage unit tests
- [ ] Update `tests/notifier.test.ts` — Telegram transport, multi-channel dispatch
- [ ] Update `tests/executor.test.ts` — per-channel delivery status
- [ ] `tests/mcp-telegram.test.ts` — test_telegram MCP tool tests
- [ ] Update `tests/health.test.ts` — per-channel delivery stats

*Test approach: Unit-test Telegram functions with mocked fetch. Update existing notification/executor tests for per-channel status tracking.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Telegram bot sends real message | TLG-01 | Requires real bot token and chat ID | Configure env vars, trigger agent execution, verify message in Telegram |
| MarkdownV2 renders correctly | TLG-02 | Visual verification in Telegram app | Send test message, check formatting in Telegram UI |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
