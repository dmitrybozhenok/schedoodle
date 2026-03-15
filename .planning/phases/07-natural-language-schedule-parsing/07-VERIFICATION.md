---
phase: 07-natural-language-schedule-parsing
verified: 2026-03-15T00:55:00Z
status: passed
score: 6/6 success criteria verified
re_verification: false
gaps:
  - truth: "NLP-01 through NLP-07 requirement IDs are defined and traced in REQUIREMENTS.md"
    status: resolved
    reason: "REQUIREMENTS.md does not define or trace NLP-01 through NLP-07. The IDs are referenced in ROADMAP.md (Phase 7 Requirements field) and both PLAN files, but no definitions exist in REQUIREMENTS.md. The feature itself appears in the Out of Scope table ('Natural language schedule input') with the note 'Use cron expressions; link to crontab.guru in docs'. The Traceability table in REQUIREMENTS.md covers only Phases 1-6 (AGNT, EXEC, SCHD, RSLN, NOTF, OBSV requirements). Phase 7 is absent."
    artifacts:
      - path: ".planning/REQUIREMENTS.md"
        issue: "NLP-01 through NLP-07 are not defined. The traceability table ends at Phase 6. 'Natural language schedule input' is listed as Out of Scope."
    missing:
      - "Define NLP-01 through NLP-07 requirements under a new '### Natural Language Schedule Parsing' section in REQUIREMENTS.md"
      - "Remove or update the Out of Scope entry for 'Natural language schedule input' to reflect that it was implemented in Phase 7"
      - "Add NLP-01 through NLP-07 rows to the Traceability table (Phase 7, Status: Complete)"
      - "Update the Coverage count (currently '16 total' v1 requirements) to reflect the addition"
human_verification: []
---

# Phase 7: Natural Language Schedule Parsing — Verification Report

**Phase Goal:** Users can describe when they want an agent to run in plain English, and the system translates it to a cron expression with a human-readable confirmation before saving
**Verified:** 2026-03-15T00:55:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Natural language input like "every weekday at 9am" is translated to a valid cron expression | VERIFIED | `parseSchedule` calls LLM with structured Zod output; test at line 38 of schedule-parser.test.ts asserts cronExpression "0 9 * * 1-5" for NL input |
| 2 | Response includes both cron expression and human-readable description (e.g., "At 09:00, Monday through Friday") | VERIFIED | `cronstrue.toString(expr, { use24HourTimeFormat: true })` called in schedule-parser.ts lines 41 and 88; test asserts humanReadable = "At 09:00, Monday through Friday" |
| 3 | If input is already a valid cron expression, it is described without an LLM call | VERIFIED | `isCronExpression` fast-path at line 40 of schedule-parser.ts returns early before any `generateText` call; test at line 57 asserts `mockGenerateText` was NOT called |
| 4 | Ambiguous input returns a low-confidence warning so users can verify | VERIFIED | `response.warning` set to "This interpretation may not match your intent. Please verify." when `result.confidence === "low"` (schedule-parser.ts line 100); route test at line 103 and parser test at line 67 both verify |
| 5 | Unparseable input returns a 422 with guidance and example suggestions | VERIFIED | schedules.ts lines 52-65 return 422 with `error`, `message`, and `suggestions` array on generic Error; route test at line 127 verifies status 422 and suggestions |
| 6 | LLM unavailability returns a 503 with fallback guidance to use raw cron | VERIFIED | schedules.ts lines 41-50 catch `CircuitBreakerOpenError` and return 503 with message containing "cron expression directly"; route test at line 144 verifies |

**Score: 6/6 success criteria verified**

---

### Required Artifacts

#### Plan 01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/helpers/cron-detect.ts` | isCronExpression function | VERIFIED | 27 lines; exports `isCronExpression`; triple validation: field count (5-7), CRON_CHARS regex, croner try/catch |
| `src/schemas/schedule-input.ts` | Zod schemas for parse request/response | VERIFIED | 36 lines; exports `parseScheduleBody`, `scheduleParseSchema`, `ScheduleParseResult`, `ParseScheduleResponse` — all named exports match plan |
| `src/services/schedule-parser.ts` | NL-to-cron parsing service using LLM + cronstrue | VERIFIED | 104 lines; exports `parseSchedule`; cron bypass, LLM path, NoObjectGeneratedError retry, croner validation, cronstrue description |
| `tests/cron-detect.test.ts` | Unit tests for cron detection (min 20 lines) | VERIFIED | 40 lines; 9 tests covering all behaviors specified in plan tasks |
| `tests/schedule-parser.test.ts` | Unit tests for schedule parser with mocked LLM (min 40 lines) | VERIFIED | 138 lines; 7 tests: NL translation, cron bypass, low confidence warning, invalid cron throw, retry on NoObjectGeneratedError, retry failure propagation, croner validation |

#### Plan 02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/routes/schedules.ts` | Schedule parse route factory | VERIFIED | 70 lines; exports `createScheduleRoutes`; zodErrorHook, POST /parse handler, CircuitBreakerOpenError catch for 503, generic Error catch for 422 |
| `src/index.ts` | Wires /schedules route into app | VERIFIED | Line 10 imports `createScheduleRoutes`; line 39 mounts `app.route("/schedules", createScheduleRoutes())` |
| `tests/routes-schedules.test.ts` | Route-level tests (min 50 lines) | VERIFIED | 166 lines; 8 tests: NL 200, cron bypass 200, empty 400, missing body 400, low confidence 200 with warning, generic error 422, CircuitBreakerOpenError 503, GET 404 |

---

### Key Link Verification

#### Plan 01 Key Links

| From | To | Via | Status | Evidence |
|------|----|-----|--------|---------|
| `src/services/schedule-parser.ts` | `src/schemas/schedule-input.ts` | import scheduleParseSchema | WIRED | Lines 6-7: `import type { ParseScheduleResponse, ScheduleParseResult }` and `import { scheduleParseSchema }` from `../schemas/schedule-input.js` |
| `src/services/schedule-parser.ts` | `src/helpers/cron-detect.ts` | import isCronExpression | WIRED | Line 5: `import { isCronExpression } from "../helpers/cron-detect.js"` — called on line 40 and in fast-path condition |
| `src/services/schedule-parser.ts` | cronstrue | import cronstrue | WIRED | Line 3: `import cronstrue from "cronstrue"` — called on lines 41 and 88 with `use24HourTimeFormat: true` |

#### Plan 02 Key Links

| From | To | Via | Status | Evidence |
|------|----|-----|--------|---------|
| `src/routes/schedules.ts` | `src/services/schedule-parser.ts` | import parseSchedule | WIRED | Line 5: `import { parseSchedule }` — called on line 38 inside POST /parse handler |
| `src/routes/schedules.ts` | `src/schemas/schedule-input.ts` | import parseScheduleBody for request validation | WIRED | Line 3: `import { parseScheduleBody }` — used on line 34 as zValidator argument |
| `src/index.ts` | `src/routes/schedules.ts` | app.route('/schedules', createScheduleRoutes()) | WIRED | Line 10 imports `createScheduleRoutes`; line 39: `app.route("/schedules", createScheduleRoutes())` |

---

### Requirements Coverage

**Critical finding: NLP-01 through NLP-07 do not exist in REQUIREMENTS.md.**

The PLAN files declare requirements `NLP-01` through `NLP-07` and ROADMAP.md references them under Phase 7. However:

1. REQUIREMENTS.md contains no definition of any NLP-prefixed requirement ID anywhere.
2. The Traceability table in REQUIREMENTS.md covers only Phases 1-6 and makes no mention of Phase 7 or any NLP requirement.
3. "Natural language schedule input" appears under the **Out of Scope** table in REQUIREMENTS.md with the note "Use cron expressions; link to crontab.guru in docs" — contradicting the feature being built.
4. The Coverage line states "v1 requirements: 16 total" and "Unmapped: 0", which reflects only the pre-Phase-7 state.

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| NLP-01 | 07-01-PLAN.md | Not defined in REQUIREMENTS.md | ORPHANED | ID cited in PLAN/ROADMAP but has no definition or traceability entry |
| NLP-02 | 07-01-PLAN.md | Not defined in REQUIREMENTS.md | ORPHANED | ID cited in PLAN/ROADMAP but has no definition or traceability entry |
| NLP-03 | 07-01-PLAN.md | Not defined in REQUIREMENTS.md | ORPHANED | ID cited in PLAN/ROADMAP but has no definition or traceability entry |
| NLP-04 | 07-01-PLAN.md | Not defined in REQUIREMENTS.md | ORPHANED | ID cited in PLAN/ROADMAP but has no definition or traceability entry |
| NLP-05 | 07-02-PLAN.md | Not defined in REQUIREMENTS.md | ORPHANED | ID cited in PLAN/ROADMAP but has no definition or traceability entry |
| NLP-06 | 07-02-PLAN.md | Not defined in REQUIREMENTS.md | ORPHANED | ID cited in PLAN/ROADMAP but has no definition or traceability entry |
| NLP-07 | 07-02-PLAN.md | Not defined in REQUIREMENTS.md | ORPHANED | ID cited in PLAN/ROADMAP but has no definition or traceability entry |

All seven requirement IDs are ORPHANED — referenced in plans but never formally defined or traced in REQUIREMENTS.md.

---

### Anti-Patterns Found

Scanned all 8 created/modified files for stubs, placeholders, and incomplete implementations.

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None | — | — | No TODO/FIXME/HACK/placeholder comments found. No empty return stubs. No console.log-only implementations. |

All implementations are substantive. The `return null` / `return {}` / `return []` patterns are absent. No anti-patterns detected.

---

### Human Verification Required

None. All observable behaviors are fully testable programmatically and 201/201 tests pass.

---

### Test Results

| Test Suite | Tests | Status |
|------------|-------|--------|
| `tests/cron-detect.test.ts` | 9/9 | Passed |
| `tests/schedule-parser.test.ts` | 7/7 | Passed |
| `tests/routes-schedules.test.ts` | 8/8 | Passed |
| Full suite (`pnpm test`) | 201/201 | Passed — no regressions |

---

### Dependency Check

| Dependency | Location | Status |
|-----------|----------|--------|
| `cronstrue@^3.13.0` | `package.json` line 32 | Present |

---

### Gaps Summary

The phase goal is functionally achieved. All 6 ROADMAP success criteria are met, all 8 artifacts exist and are substantive and wired, all 24 phase-specific tests pass, and the full suite (201 tests) passes with no regressions.

The single gap is a documentation/traceability issue: **REQUIREMENTS.md was never updated for Phase 7**. The NLP-01 through NLP-07 requirement IDs cited in both PLAN files and ROADMAP.md have no definitions in REQUIREMENTS.md. Additionally, REQUIREMENTS.md still lists "Natural language schedule input" under Out of Scope, which contradicts the completed implementation.

This gap does not affect runtime behavior or test results, but it breaks the traceability contract that the planning system relies on. Closing this gap requires updating REQUIREMENTS.md to:
- Define NLP-01 through NLP-07 with descriptions matching what was built
- Add Phase 7 rows to the Traceability table
- Remove or reclassify the Out of Scope entry for natural language schedule input
- Update the v1 requirement count

---

_Verified: 2026-03-15T00:55:00Z_
_Verifier: Claude (gsd-verifier)_
