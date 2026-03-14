---
phase: 5
slug: notification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x |
| **Config file** | `vitest.config.ts` |
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
| 05-01-01 | 01 | 1 | NOTF-01, NOTF-02 | unit | `pnpm vitest run tests/notifier.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | NOTF-01 | unit | `pnpm vitest run tests/executor.test.ts -t "delivery"` | ✅ (partial) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/notifier.test.ts` — stubs for NOTF-01 (send/skip/fail), NOTF-02 (HTML content, data block)
- [ ] Updated `tests/executor.test.ts` — delivery isolation tests (deliveryStatus updates, failure doesn't affect execution)

*Existing infrastructure covers framework and config — only new test files needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Email renders correctly in inbox | NOTF-02 | Email client rendering varies | Send test email, verify layout in Gmail/Outlook |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
