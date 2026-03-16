---
phase: 19
slug: expand-eval-suite-with-tool-usage-temporal-reasoning-output-format-safety-multilingual-code-generation-and-reasoning-transparency-fixtures
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + custom eval runner |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/eval/` |
| **Full suite command** | `npx vitest run tests/eval/` |
| **Estimated runtime** | ~60 seconds (includes AI judge calls) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/eval/`
- **After every plan wave:** Run `npx vitest run tests/eval/`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | TBD | fixture validation | `npx vitest run tests/eval/` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New JSONL fixture files auto-discovered by eval framework
- [ ] Existing check types cover all new categories (no new code needed)

*Existing infrastructure covers all phase requirements — pure data authoring phase.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tool-usage URL stability | TBD | External API availability | Verify jsonplaceholder/httpbin endpoints respond |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
