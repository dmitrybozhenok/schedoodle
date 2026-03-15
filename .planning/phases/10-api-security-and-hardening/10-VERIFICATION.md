---
phase: 10-api-security-and-hardening
verified: 2026-03-15T04:00:00Z
status: passed
score: 11/11 must-haves verified
re_verification: false
---

# Phase 10: API Security and Hardening Verification Report

**Phase Goal:** Protect all API endpoints with bearer token authentication, harden URL prefetch against SSRF and memory abuse, add input length constraints to agent fields, add rate limiting to LLM-invoking endpoints, and configure CORS and security headers.
**Verified:** 2026-03-15T04:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Requests without valid Bearer token are rejected with 401 when AUTH_TOKEN is set | VERIFIED | `src/middleware/auth.ts` lines 6-16: checks `env.AUTH_TOKEN`, returns `c.json({ error: "Unauthorized" }, 401)` on missing/wrong/malformed header |
| 2  | All requests pass through when AUTH_TOKEN is not configured (backward-compatible) | VERIFIED | `auth.ts` line 6-8: `if (!env.AUTH_TOKEN) { await next(); return; }` |
| 3  | Every response includes X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: same-origin | VERIFIED | `src/middleware/security.ts` lines 5-9: `secureHeaders({ xFrameOptions: "DENY", referrerPolicy: "same-origin" })`; nosniff is hono/secure-headers default |
| 4  | Cross-origin requests receive no Access-Control-Allow-Origin header | VERIFIED | `security.ts` lines 12-15: `cors({ origin: () => "" })` returns empty string for all origins |
| 5  | LLM-invoking endpoints return 429 after 10 requests/minute per IP | VERIFIED | `rate-limiter.ts` lines 37-54: `isLlmEndpoint` matches `/agents/:id/execute` and `/schedules/parse`; limit is `LLM_MAX_REQUESTS = 10` |
| 6  | General endpoints return 429 after 60 requests/minute per IP | VERIFIED | `rate-limiter.ts` line 46-47: `GENERAL_MAX_REQUESTS = 60` applied for non-LLM paths |
| 7  | URLs pointing to private IP ranges are blocked before fetch | VERIFIED | `src/services/prefetch.ts` lines 14-57: `isPrivateUrl()` checks all RFC-1918 ranges, localhost, IPv6 loopback, non-HTTP protocols, malformed URLs |
| 8  | Prefetch aborts and returns truncation message when response body exceeds 1 MB | VERIFIED | `prefetch.ts` lines 63-103: `fetchWithSizeLimit()` with `MAX_RESPONSE_BYTES = 1_048_576`, Content-Length fast path and streaming reader |
| 9  | taskDescription field rejects strings longer than 10,000 characters | VERIFIED | `src/schemas/agent-input.ts` line 5: `z.string().min(1).max(10_000)` |
| 10 | systemPrompt field rejects strings longer than 5,000 characters | VERIFIED | `agent-input.ts` line 7: `z.string().max(5_000).optional()` |
| 11 | model field rejects strings longer than 100 characters | VERIFIED | `agent-input.ts` line 8: `z.string().max(100).optional()` |

**Score:** 11/11 truths verified

---

### Required Artifacts

#### Plan 10-01 Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `src/middleware/auth.ts` | Bearer token auth middleware conditional on AUTH_TOKEN env | Yes | Yes — 20 lines, real conditional auth logic | Yes — imported and used via `app.use(authMiddleware())` in `src/index.ts` | VERIFIED |
| `src/middleware/security.ts` | CORS and security headers middleware configuration | Yes | Yes — 16 lines, exports `securityHeaders()` and `corsMiddleware()` | Yes — imported and both called in `src/index.ts` | VERIFIED |
| `src/middleware/rate-limiter.ts` | In-memory per-IP sliding window rate limiter | Yes | Yes — 79 lines, sliding window algorithm, cleanup timer, all exports present | Yes — imported and used via `app.use(rateLimiterMiddleware())` in `src/index.ts` | VERIFIED |
| `src/index.ts` | All middleware mounted in correct order before routes | Yes | Yes — middleware mount order: secureHeaders -> CORS -> rateLimiter -> auth -> routes | Yes — is the app entry point | VERIFIED |

#### Plan 10-02 Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `src/services/prefetch.ts` | SSRF-safe URL prefetching with 1MB size limit | Yes | Yes — 174 lines, exports `isPrivateUrl`, `prefetchUrls`, `extractUrls`, `buildPrompt` | Yes — `isPrivateUrl` called in `prefetchUrls` loop before every fetch | VERIFIED |
| `src/schemas/agent-input.ts` | Zod schemas with max length constraints on all string fields | Yes | Yes — 15 lines, `.max(10_000)`, `.max(5_000)`, `.max(100)` present | Yes — schema is the contract used by agent routes | VERIFIED |

---

### Key Link Verification

#### Plan 10-01 Key Links

| From | To | Via | Status | Evidence |
|------|----|-----|--------|----------|
| `src/index.ts` | `src/middleware/auth.ts` | `app.use(authMiddleware())` | WIRED | Line 35: `app.use(authMiddleware())` after import on line 6 |
| `src/index.ts` | `src/middleware/rate-limiter.ts` | `app.use(rateLimiterMiddleware())` | WIRED | Line 34: `app.use(rateLimiterMiddleware())`, `stopRateLimiterCleanup()` called in `shutdown()` line 70 |
| `src/middleware/auth.ts` | `src/config/env.ts` | import env for AUTH_TOKEN check | WIRED | Line 2: `import { env } from "../config/env.js"`, `env.AUTH_TOKEN` used on lines 6 and 14 |

#### Plan 10-02 Key Links

| From | To | Via | Status | Evidence |
|------|----|-----|--------|----------|
| `src/services/prefetch.ts` | `isPrivateUrl` | Called before each fetch() in prefetchUrls loop | WIRED | Lines 131-133: `if (isPrivateUrl(url)) { return { url, content: \`[SSRF blocked...]\` }; }` |
| `src/services/prefetch.ts` | `fetch()` | fetchWithSizeLimit replaces raw fetch for 1MB enforcement | WIRED | Line 135: `const { content, contentType } = await fetchWithSizeLimit(url)`, `MAX_RESPONSE_BYTES` enforced in lines 72 and 92 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SEC-01 | 10-01 | Auth middleware blocks requests without valid Bearer token when AUTH_TOKEN env var is set | SATISFIED | `auth.ts`: rejects missing/wrong/malformed token with 401; 4 tests pass |
| SEC-02 | 10-01 | Auth middleware passes through all requests when AUTH_TOKEN is not configured | SATISFIED | `auth.ts`: passthrough when `!env.AUTH_TOKEN`; test verifies 200 with no header |
| SEC-03 | 10-02 | SSRF check blocks private/internal IP ranges before URL prefetch | SATISFIED | `isPrivateUrl()` in prefetch.ts; 16 tests cover all private ranges and edge cases |
| SEC-04 | 10-02 | URL prefetch aborts and returns truncation message when response body exceeds 1 MB | SATISFIED | `fetchWithSizeLimit()` with Content-Length fast path and streaming reader; tests cover both paths |
| SEC-05 | 10-02 | Input field limits enforce max lengths via Zod (taskDescription: 10k, systemPrompt: 5k, model: 100) | SATISFIED | `agent-input.ts`: all three `.max()` constraints present; 9 tests cover boundary values |
| SEC-06 | 10-01 | In-memory per-IP rate limiter returns 429 after threshold (10/min LLM, 60/min general) | SATISFIED | `rate-limiter.ts`: sliding window per-IP; 5 tests cover LLM endpoints, general, and per-IP isolation |
| SEC-07 | 10-01 | All responses include security headers: X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: same-origin | SATISFIED | `security.ts`: `secureHeaders({ xFrameOptions: "DENY", referrerPolicy: "same-origin" })`; 3 header tests pass |
| SEC-08 | 10-01 | CORS blocks cross-origin requests (no permissive Access-Control-Allow-Origin) | SATISFIED | `security.ts`: `cors({ origin: () => "" })`; 2 CORS tests pass |

All 8 requirements satisfied. No orphaned requirements.

---

### Anti-Patterns Found

No blocking anti-patterns found.

The one match flagged during scanning was `return []` in `prefetch.ts` line 110 — this is a legitimate early return when no URLs are found in text, not a stub.

---

### Test Results

All 59 phase-10 tests pass with 0 failures:

| Test File | Tests | Result |
|-----------|-------|--------|
| `tests/middleware-auth.test.ts` | 5 | PASS |
| `tests/middleware-security.test.ts` | 5 | PASS |
| `tests/middleware-rate-limiter.test.ts` | 5 | PASS |
| `tests/ssrf.test.ts` | 16 | PASS |
| `tests/prefetch.test.ts` | 14 (4 new) | PASS |
| `tests/schemas.test.ts` | 14 (9 new) | PASS |

All 8 task commits verified in git history: `c5cb423`, `74f14fe`, `6351c0e`, `dd3b59a`, `defe0e0`, `11030a2`, `10727e6`, `9d611b4`.

---

### Human Verification Required

None. All phase 10 goals are programmatically verifiable via middleware logic and schema constraints. No UI behavior, external service integration, or real-time behavior is involved.

---

### Summary

Phase 10 fully achieves its goal. All five security objectives are implemented and tested:

1. **Bearer token auth** — Conditional on `AUTH_TOKEN` env var, backward-compatible when unset, proper JSON error response, mounted before all routes.
2. **Security headers** — X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: same-origin on every response via hono/secure-headers.
3. **CORS** — All cross-origin requests denied by returning empty string from origin callback; preflight gets no permissive headers.
4. **Rate limiting** — Per-IP sliding window: 10/min for LLM endpoints (`/agents/:id/execute`, `/schedules/parse`), 60/min for all others. Cleanup timer uses `unref()` to avoid keeping process alive. `stopRateLimiterCleanup()` called in graceful shutdown.
5. **SSRF + size hardening** — `isPrivateUrl()` blocks all RFC-1918 ranges, loopback, link-local, localhost, IPv6 loopback, non-HTTP protocols, and malformed URLs. `fetchWithSizeLimit()` enforces 1 MB via Content-Length header fast path and streaming reader.

Middleware mount order in `src/index.ts` is correct: `securityHeaders -> corsMiddleware -> rateLimiterMiddleware -> authMiddleware -> routes`.

---

_Verified: 2026-03-15T04:00:00Z_
_Verifier: Claude (gsd-verifier)_
