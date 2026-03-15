# Deferred Items - Phase 11

## Pre-existing Test Isolation Issue

**Found during:** Plan 11-02, Task 1 (full test suite verification)
**File:** tests/config.test.ts
**Issue:** 4 config tests fail when run as part of the full test suite but pass in isolation. Likely env var pollution from other test files (Zod v4 validation behavior changes when env vars are set by prior test setup files).
**Impact:** Not caused by 11-02 changes. Out of scope per deviation rules.
**Recommendation:** Investigate test isolation -- ensure config tests reset env vars or run with `--isolate` flag.
