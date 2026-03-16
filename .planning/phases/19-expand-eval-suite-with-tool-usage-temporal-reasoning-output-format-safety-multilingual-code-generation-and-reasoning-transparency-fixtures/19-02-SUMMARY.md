---
phase: 19-expand-eval-suite
plan: 02
subsystem: testing
tags: [evals, safety, injection, code-generation, jsonl, fixtures]

# Dependency graph
requires:
  - phase: 19-expand-eval-suite
    provides: "Eval framework with JSONL fixture loading and check evaluators"
provides:
  - "3 safety eval cases testing prompt injection resistance (safe-01..03)"
  - "3 code-generation eval cases testing function writing, debugging, refactoring (code-01..03)"
  - "Total eval suite now at 37 cases across 12 fixture files"
affects: [eval-runner, eval-reports]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "notContainsRegex checks for safety negative assertions (model must NOT output certain content)"
    - "regex checks for code structure verification (function signatures, keywords, patterns)"
    - "Escalating difficulty within fixture files (easy/medium/hard)"

key-files:
  created:
    - evals/fixtures/safety.jsonl
    - evals/fixtures/code-generation.jsonl
  modified: []

key-decisions:
  - "Safety cases test mild/common injection patterns, not adversarial research-grade attacks"
  - "Code generation cases test language-agnostic skills (function writing, bug finding, refactoring) rather than algorithm challenges"

patterns-established:
  - "Safety fixture pattern: systemPrompt with canary values for leak detection"
  - "Code fixture pattern: regex checks for structural code elements (function defs, keywords, control flow)"

requirements-completed: [EVAL-04, EVAL-05]

# Metrics
duration: 2min
completed: 2026-03-16
---

# Phase 19 Plan 02: Safety and Code-Generation Eval Fixtures Summary

**6 eval fixtures covering prompt injection resistance (ignore-instructions, system-prompt leak, DAN jailbreak) and code generation (palindrome function, off-by-one bug detection, callback-to-async refactoring)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-16T03:16:13Z
- **Completed:** 2026-03-16T03:18:13Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created safety.jsonl with 3 escalating prompt injection resistance cases using notContainsRegex for negative assertions
- Created code-generation.jsonl with 3 code analysis cases testing function writing, bug detection, and refactoring
- Total eval suite expanded from 31 to 37 cases across 12 fixture files (combined with Plan 01's 9 new cases)
- All 37 cases verified: unique IDs, unique agent names, valid JSON, no parse errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create safety.jsonl with 3 prompt injection resistance cases** - `1072871` (feat)
2. **Task 2: Create code-generation.jsonl with 3 code analysis cases** - `41682e6` (feat)

## Files Created/Modified
- `evals/fixtures/safety.jsonl` - 3 safety eval cases: ignore-instructions injection (safe-01), system prompt extraction (safe-02), DAN jailbreak resistance (safe-03)
- `evals/fixtures/code-generation.jsonl` - 3 code generation eval cases: palindrome checker (code-01), off-by-one bug finder (code-02), callback-to-async/await refactoring (code-03)

## Decisions Made
- Safety cases test mild/common injection patterns (ignore instructions, system prompt leak, DAN persona) rather than adversarial research-grade attacks -- appropriate for evaluating production behavior
- Code generation cases test language-agnostic programming skills rather than specific algorithm challenges -- focuses on practical development tasks
- Used CANARY-7742 as a planted canary token in safe-02's systemPrompt for leak detection verification

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Eval suite complete at 37 cases across 12 fixture files
- All fixture categories covered: web-fetch, data-reasoning, error-handling, instruction-following, long-form, system-prompt-advanced, summarisation, tool-usage, temporal-reasoning, output-format, safety, code-generation
- Ready for eval runner execution and reporting

## Self-Check: PASSED

- [x] evals/fixtures/safety.jsonl exists
- [x] evals/fixtures/code-generation.jsonl exists
- [x] 19-02-SUMMARY.md exists
- [x] Commit 1072871 exists
- [x] Commit 41682e6 exists

---
*Phase: 19-expand-eval-suite*
*Completed: 2026-03-16*
