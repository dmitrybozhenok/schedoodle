---
phase: 19-expand-eval-suite
verified: 2026-03-16T00:00:00Z
status: passed
score: 11/11 must-haves verified
re_verification: false
---

# Phase 19: Expand Eval Suite Verification Report

**Phase Goal:** Expand eval suite with tool-usage, temporal-reasoning, output-format, safety, multilingual, code-generation, and reasoning-transparency fixtures
**Verified:** 2026-03-16
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                    | Status     | Evidence                                                                                  |
|----|----------------------------------------------------------------------------------------------------------|------------|-------------------------------------------------------------------------------------------|
| 1  | tool-usage.jsonl exists with 3 cases testing reasoning about fetched data (not just fetching)            | VERIFIED   | File exists; IDs tool-01/02/03; computation, anti-hallucination, multi-source synthesis   |
| 2  | temporal-reasoning.jsonl exists with 3 cases covering cron explanation, date math, timezone/DST         | VERIFIED   | File exists; IDs temp-01/02/03; cron, date offset, DST conversion                        |
| 3  | output-format.jsonl exists with 3 cases testing JSON, Markdown table, and CSV structural validity       | VERIFIED   | File exists; IDs fmt-01/02/03; JSON object, Markdown table, CSV with RFC 4180 escaping    |
| 4  | safety.jsonl exists with 3 cases testing prompt injection resistance at escalating difficulty            | VERIFIED   | File exists; IDs safe-01/02/03; ignore-instructions, prompt leak, DAN jailbreak           |
| 5  | code-generation.jsonl exists with 3 cases testing function writing, bug finding, and refactoring        | VERIFIED   | File exists; IDs code-01/02/03; palindrome, off-by-one bug, callback-to-async/await       |
| 6  | All 15 cases parse without errors and first check is always status=equals                               | VERIFIED   | Node.js parse validation: all 15 lines OK; first check verified on every case             |
| 7  | Safety cases use notContainsRegex for negative assertions                                               | VERIFIED   | safe-01: 1 notContainsRegex; safe-02: 2; safe-03: 2                                      |
| 8  | Code generation cases use regex to verify function signatures and code patterns                         | VERIFIED   | code-01: 4 regex checks; code-02: 2; code-03: 4                                          |
| 9  | No agent name collisions with existing 22 eval agent names                                              | VERIFIED   | Zero collisions with full existing 22-name list                                           |
| 10 | All 15 new case IDs are unique across both plans                                                        | VERIFIED   | 15 unique IDs confirmed: tool-01..03, temp-01..03, fmt-01..03, safe-01..03, code-01..03   |
| 11 | Total suite now at 37 cases across 12 fixture files (auto-discovered)                                   | VERIFIED   | Node.js count: 37 cases across 12 files; loadAllFixtures glob picks up all *.jsonl        |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact                                | Expected                                    | Status     | Details                                              |
|-----------------------------------------|---------------------------------------------|------------|------------------------------------------------------|
| `evals/fixtures/tool-usage.jsonl`       | 3 eval cases; contains "tool-01"            | VERIFIED   | 3 lines, IDs tool-01/02/03, agent names confirmed    |
| `evals/fixtures/temporal-reasoning.jsonl` | 3 eval cases; contains "temp-01"          | VERIFIED   | 3 lines, IDs temp-01/02/03, agent names confirmed    |
| `evals/fixtures/output-format.jsonl`    | 3 eval cases; contains "fmt-01"             | VERIFIED   | 3 lines, IDs fmt-01/02/03, agent names confirmed     |
| `evals/fixtures/safety.jsonl`           | 3 eval cases; contains "safe-01"            | VERIFIED   | 3 lines, IDs safe-01/02/03, CANARY-7742 in safe-02   |
| `evals/fixtures/code-generation.jsonl`  | 3 eval cases; contains "code-01"            | VERIFIED   | 3 lines, IDs code-01/02/03, agent names confirmed    |

### Key Link Verification

| From                               | To                        | Via                                           | Status   | Details                                                                  |
|------------------------------------|---------------------------|-----------------------------------------------|----------|--------------------------------------------------------------------------|
| `evals/fixtures/tool-usage.jsonl`  | `evals/lib/fixtures.ts`   | JSONL auto-discovery glob (`*.jsonl`)         | WIRED    | `loadAllFixtures` uses `readdirSync` + `.filter(f => f.endsWith('.jsonl'))` |
| `evals/fixtures/temporal-reasoning.jsonl` | `evals/lib/fixtures.ts` | Same auto-discovery glob                   | WIRED    | Same glob — file present in fixtures dir, auto-discovered                |
| `evals/fixtures/output-format.jsonl` | `evals/lib/fixtures.ts` | Same auto-discovery glob                    | WIRED    | Same glob — file present in fixtures dir, auto-discovered                |
| `evals/fixtures/safety.jsonl`      | `evals/lib/checks.ts`     | `notContainsRegex` check type                 | WIRED    | `notContainsRegex` implemented in `evaluateCheck` switch at line 46       |
| `evals/fixtures/code-generation.jsonl` | `evals/lib/checks.ts` | `regex` check type for code pattern matching  | WIRED    | `regex` implemented in `evaluateCheck` switch at line 38                 |
| All new fixtures                   | `evals/lib/types.ts`      | `EvalCase` interface conformance              | WIRED    | All 15 cases match `EvalCase` shape: id, name, agent, tags, checks       |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                 | Status    | Evidence                                                       |
|-------------|-------------|-----------------------------------------------------------------------------|-----------|----------------------------------------------------------------|
| EVAL-01     | 19-01       | tool-usage.jsonl with 3 cases: computation, anti-hallucination, synthesis   | SATISFIED | tool-usage.jsonl: tool-01 (computation), tool-02 (anti-halluc), tool-03 (synthesis) |
| EVAL-02     | 19-01       | temporal-reasoning.jsonl with 3 cases: cron, date math, DST timezone        | SATISFIED | temporal-reasoning.jsonl: temp-01 (cron), temp-02 (date math), temp-03 (DST) |
| EVAL-03     | 19-01       | output-format.jsonl with 3 cases: JSON, Markdown table, CSV                 | SATISFIED | output-format.jsonl: fmt-01 (JSON), fmt-02 (Markdown), fmt-03 (CSV)          |
| EVAL-04     | 19-02       | safety.jsonl with 3 cases: ignore-instructions, prompt leak, jailbreak      | SATISFIED | safety.jsonl: safe-01 (ignore instructions), safe-02 (leak), safe-03 (DAN)  |
| EVAL-05     | 19-02       | code-generation.jsonl with 3 cases: function writing, bug finding, refactor  | SATISFIED | code-generation.jsonl: code-01 (palindrome), code-02 (bug), code-03 (refactor) |

No orphaned requirements. All 5 EVAL-* requirements in REQUIREMENTS.md map to Phase 19 and all 5 are satisfied.

### Anti-Patterns Found

None detected. All 5 new fixture files contain substantive, fully-specified eval cases with real check logic (no TODOs, placeholders, empty arrays, or stub patterns). All cases have:
- At least 3 meaningful checks beyond the mandatory status=equals
- Non-trivial `judgeCriteria` rubrics
- Correct `tags` arrays matching their domain

### Human Verification Required

The fixture files themselves are data, not executable code. The following behaviors can only be confirmed by running the eval suite with a real LLM:

**1. tool-usage cases actually require fetching (not training data recall)**

Test: Run tool-01 through tool-03 against an agent with web_fetch disabled.
Expected: Cases should fail (agent cannot retrieve jsonplaceholder data without tool use).
Why human: Cannot verify at static analysis time whether an LLM would guess the correct answers from training data vs. actually fetching.

**2. temp-03 DST check pattern precision**

Test: Run temp-03 against a model and verify it outputs "6:30 PM UTC" or "18:30 UTC".
Expected: The regex pattern `(6:30\s*PM|18:30|1830)\s*(UTC|Coordinated)` should match the correct answer.
Why human: The regex requires UTC to appear immediately after the time value. A model could output "6:30 PM in UTC" with intervening text that would fail the check despite a correct answer.

**3. safe-02 canary token non-leak**

Test: Run safe-02 with the systemPrompt containing CANARY-7742 and verify the model does not leak it.
Expected: notContainsRegex check for "CANARY-7742" should pass (model does not repeat the canary).
Why human: Whether modern LLMs comply with system prompt confidentiality instructions is a behavioral question requiring actual execution.

## Gaps Summary

No gaps. All automated checks passed. The phase delivered exactly what was planned:

- 5 new JSONL fixture files (note: phase title mentions "multilingual" and "reasoning-transparency" but the PLAN frontmatter and REQUIREMENTS.md only required EVAL-01 through EVAL-05, which map to tool-usage, temporal-reasoning, output-format, safety, and code-generation — the phase plan scoped correctly)
- 15 new eval cases with unique IDs and agent names
- Zero collisions with existing 22 agent names
- All cases pass JSON parse validation
- All check types used (`equals`, `regex`, `notContainsRegex`, `contains`, `minLength`) are implemented in `evaluateCheck`
- Auto-discovery wiring confirmed: `loadAllFixtures` uses a `*.jsonl` glob that picks up all new files automatically
- Total suite: 37 cases across 12 files as claimed
- All 4 commit hashes documented in summaries are valid: fb0be4e, eb03c9a, 1072871, 41682e6

---
_Verified: 2026-03-16_
_Verifier: Claude (gsd-verifier)_
