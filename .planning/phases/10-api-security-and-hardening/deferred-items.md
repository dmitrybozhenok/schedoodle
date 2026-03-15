# Phase 10 Deferred Items

## Pre-existing Issues Discovered

### 1. Flaky timing assertion in executor.test.ts
- **File:** tests/executor.test.ts:458
- **Test:** "circuit breaker trips after consecutive failures and rejects fast"
- **Issue:** `expect(elapsed).toBeLessThan(50)` fails when elapsed is exactly 50ms (boundary condition)
- **Fix:** Change assertion to `toBeLessThan(100)` or use a more generous timing window
- **Not caused by Phase 10 changes**
