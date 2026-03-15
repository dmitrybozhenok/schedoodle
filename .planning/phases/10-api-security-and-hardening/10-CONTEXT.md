# Phase 10: API Security and Hardening - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Protect all API endpoints with bearer token authentication, harden URL prefetch against SSRF and memory abuse, add input length constraints to agent fields, add rate limiting to LLM-invoking endpoints, and configure CORS and security headers. No user management, no OAuth, no session handling.

</domain>

<decisions>
## Implementation Decisions

### Authentication
- Single bearer token via `AUTH_TOKEN` env var
- Validated via `Authorization: Bearer <token>` header
- All endpoints require auth when `AUTH_TOKEN` is set
- Optional — if `AUTH_TOKEN` is not configured, auth is skipped entirely (backward-compatible)
- Failed auth returns `{ "error": "Unauthorized" }` with 401 status — no detail leakage
- Implemented as Hono middleware mounted before all routes

### SSRF protection
- Block private/internal IP ranges before fetching: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1
- No DNS rebinding check (keep simple)
- No domain allowlist (users need to fetch arbitrary public URLs)

### Response size limit
- Abort URL prefetch if response body exceeds 1 MB
- Check Content-Length header before reading; use streaming reader with byte counter as fallback
- Truncated fetches recorded as `[Content truncated at 1MB — ${url}]`

### Input field limits
- `taskDescription`: max 10,000 characters
- `systemPrompt`: max 5,000 characters
- `model`: max 100 characters
- Applied via `.max()` on existing Zod schemas in `src/schemas/agent-input.ts`

### Rate limiting
- Simple in-memory per-IP rate limiting using a Map with sliding window
- LLM-invoking endpoints (`POST /agents/:id/execute`, `POST /schedules/parse`): 10 requests/minute per IP
- All other endpoints: 60 requests/minute per IP
- Returns `{ "error": "Rate limit exceeded" }` with 429 status
- Always active regardless of auth configuration (defense in depth)
- State resets on process restart (acceptable for personal tool)

### CORS
- Same-origin only — block all cross-origin requests
- Use Hono `cors()` middleware

### Security headers
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: same-origin`
- No CSP yet (inline JS in dashboard/manage makes it complex)
- Applied via middleware on all responses

### Claude's Discretion
- Exact middleware ordering in src/index.ts
- Rate limiter cleanup strategy (stale IP entries)
- How to parse/validate IP addresses from URLs for SSRF check
- Whether to extract security middleware into its own file or keep inline

</decisions>

<specifics>
## Specific Ideas

- Auth should feel like a single env var flip — set AUTH_TOKEN and everything is protected, unset it and it works like before
- Rate limiter doesn't need to be production-grade — a simple Map with timestamps is fine for a personal tool

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/index.ts`: Hono app with `app.use(logger())` middleware already mounted — auth/CORS/headers middleware follows same pattern
- `src/services/prefetch.ts`: `prefetchUrls()` function where SSRF check and size limit need to be added
- `src/schemas/agent-input.ts`: `createAgentSchema` Zod schema where `.max()` constraints go
- `src/config/env.ts`: Zod-validated env schema where `AUTH_TOKEN` gets added

### Established Patterns
- Hono middleware via `app.use()` for cross-cutting concerns
- Zod for all input validation (schemas in `src/schemas/`)
- Env validation at startup with `safeParse` and clear error messages
- JSON error responses: `{ error: string }` pattern used everywhere

### Integration Points
- `src/index.ts` lines 22-23: middleware mount point (after logger, before routes)
- `src/services/prefetch.ts` lines 26-39: URL fetch loop where SSRF check and size limit apply
- `src/schemas/agent-input.ts`: add `.max()` to existing schema fields
- `src/config/env.ts`: add optional `AUTH_TOKEN` field to env schema

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 10-api-security-and-hardening*
*Context gathered: 2026-03-15*
