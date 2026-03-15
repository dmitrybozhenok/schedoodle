---
phase: 13
slug: ci-cd-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm run test` |
| **Full suite command** | `pnpm run test` (all 422 tests run in ~7s) |
| **Estimated runtime** | ~7 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm run lint && pnpm exec tsc --noEmit && pnpm run test && pnpm run build`
- **After every plan wave:** Run same (all four checks)
- **Before `/gsd:verify-work`:** Full suite must be green + push to master and verify all jobs green in GitHub Actions
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | CI-YAML | smoke | Push to master, check Actions tab | N/A (GitHub validates) | ⬜ pending |
| 13-01-02 | 01 | 1 | CI-LINT | smoke | `pnpm run lint` | N/A (existing) | ⬜ pending |
| 13-01-03 | 01 | 1 | CI-TYPECHECK | smoke | `pnpm exec tsc --noEmit` | N/A (existing) | ⬜ pending |
| 13-01-04 | 01 | 1 | CI-TEST | smoke | `pnpm run test` | 29 test files | ⬜ pending |
| 13-01-05 | 01 | 1 | CI-BUILD | smoke | `pnpm run build` | N/A (existing) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. The only new file is the GitHub Actions workflow YAML itself.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| GitHub Actions workflow runs on push to master | CI-YAML | Requires actual push to GitHub | Push commit, check Actions tab for green status |
| Workflow_dispatch manual trigger works | CI-DISPATCH | Requires GitHub UI interaction | Go to Actions tab, select workflow, click "Run workflow" |
| pnpm cache is restored on second run | CI-CACHE | Requires two consecutive CI runs | Check "Post pnpm/action-setup" step for cache hit |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
