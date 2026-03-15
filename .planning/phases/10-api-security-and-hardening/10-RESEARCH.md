# Phase 10: API Security and Hardening - Research

**Researched:** 2026-03-15
**Domain:** API security -- authentication, SSRF protection, input validation, rate limiting, CORS, security headers
**Confidence:** HIGH

## Summary

Phase 10 hardens the existing Schedoodle API with six security layers: bearer token authentication, SSRF protection on URL prefetch, input field length limits, per-IP rate limiting, CORS restriction, and security headers. All decisions are locked by the user -- no alternatives need to be explored.

Hono provides built-in middleware for three of the six concerns: `bearerAuth` (from `hono/bearer-auth`), `cors` (from `hono/cors`), and `secureHeaders` (from `hono/secure-headers`). These are well-documented, battle-tested, and already part of the Hono dependency (v4.12.8 installed). The remaining three concerns (SSRF blocking, rate limiting, input limits) require custom middleware or modifications to existing code. All implementation can be done with zero new dependencies.

**Primary recommendation:** Use Hono's built-in bearer-auth, cors, and secure-headers middleware. Hand-write the rate limiter (~40 lines), SSRF checker (~50 lines), and input field limits (one-line Zod `.max()` additions). Extract all security middleware into `src/middleware/security.ts` for clean separation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Authentication
- Single bearer token via `AUTH_TOKEN` env var
- Validated via `Authorization: Bearer <token>` header
- All endpoints require auth when `AUTH_TOKEN` is set
- Optional -- if `AUTH_TOKEN` is not configured, auth is skipped entirely (backward-compatible)
- Failed auth returns `{ "error": "Unauthorized" }` with 401 status -- no detail leakage
- Implemented as Hono middleware mounted before all routes

#### SSRF protection
- Block private/internal IP ranges before fetching: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1
- No DNS rebinding check (keep simple)
- No domain allowlist (users need to fetch arbitrary public URLs)

#### Response size limit
- Abort URL prefetch if response body exceeds 1 MB
- Check Content-Length header before reading; use streaming reader with byte counter as fallback
- Truncated fetches recorded as `[Content truncated at 1MB -- ${url}]`

#### Input field limits
- `taskDescription`: max 10,000 characters
- `systemPrompt`: max 5,000 characters
- `model`: max 100 characters
- Applied via `.max()` on existing Zod schemas in `src/schemas/agent-input.ts`

#### Rate limiting
- Simple in-memory per-IP rate limiting using a Map with sliding window
- LLM-invoking endpoints (`POST /agents/:id/execute`, `POST /schedules/parse`): 10 requests/minute per IP
- All other endpoints: 60 requests/minute per IP
- Returns `{ "error": "Rate limit exceeded" }` with 429 status
- Always active regardless of auth configuration (defense in depth)
- State resets on process restart (acceptable for personal tool)

#### CORS
- Same-origin only -- block all cross-origin requests
- Use Hono `cors()` middleware

#### Security headers
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

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

## Standard Stack

### Core (already installed, zero new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hono | 4.12.8 | Web framework with built-in security middleware | Already the project's framework; bearerAuth, cors, secureHeaders built-in |
| zod | 4.3.6 | Input validation with `.max()` string constraints | Already used for all schemas |

### Built-in Hono Middleware (no install needed)

| Import | Purpose | Config Needed |
|--------|---------|---------------|
| `bearerAuth` from `hono/bearer-auth` | Bearer token authentication | `token`, custom error responses |
| `cors` from `hono/cors` | CORS header control | `origin` callback returning empty string |
| `secureHeaders` from `hono/secure-headers` | Security headers (X-Frame-Options, etc.) | `xFrameOptions: 'DENY'`, `referrerPolicy: 'same-origin'` |

### Node.js Built-in Modules

| Module | Purpose | Why |
|--------|---------|-----|
| `node:url` (URL constructor) | Parse URLs to extract hostname for SSRF check | WHATWG URL API -- safe, standardized |
| `node:net` (net.isIP) | Detect if hostname is a raw IP (v4/v6) | Built-in, no dependencies |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom rate limiter | `hono-rate-limiter` npm package | User specified in-memory Map; external package is overkill for personal tool |
| Custom SSRF check | `ssrf-req-filter` npm package | Packages have had SSRF bypass CVEs; simple hand-written check is safer for known scope |
| Hono `bearerAuth` | Custom middleware | bearerAuth handles edge cases (missing header, malformed header) but needs wrapper for optional auth |

**Installation:** No new packages needed. All features use Hono built-ins + custom middleware.

## Architecture Patterns

### Recommended File Structure

```
src/
  middleware/
    auth.ts          # Bearer token auth middleware (conditional on AUTH_TOKEN env)
    rate-limiter.ts  # In-memory per-IP rate limiter with sliding window
    security.ts      # Re-export of cors + secureHeaders config (single mount point)
  services/
    prefetch.ts      # MODIFIED: add isPrivateUrl() + response size limiting
  schemas/
    agent-input.ts   # MODIFIED: add .max() constraints
  config/
    env.ts           # MODIFIED: add optional AUTH_TOKEN field
  index.ts           # MODIFIED: mount middleware before routes
```

**Recommendation:** Extract security middleware into `src/middleware/` directory. This matches the project's existing pattern of `src/services/`, `src/routes/`, `src/schemas/`, `src/helpers/`. Separating concerns makes testing straightforward -- each middleware file can be unit tested independently.

### Pattern 1: Conditional Auth Middleware

**What:** Wrap Hono's `bearerAuth` to make it conditional based on `AUTH_TOKEN` env var presence.
**When to use:** When auth should be optional (personal tool without mandatory login).
**Why not raw bearerAuth:** `bearerAuth` always requires a token. We need a wrapper that calls `next()` when `AUTH_TOKEN` is not set.

```typescript
// Source: Hono bearerAuth docs (https://hono.dev/docs/middleware/builtin/bearer-auth)
import { bearerAuth } from 'hono/bearer-auth';
import type { MiddlewareHandler } from 'hono';
import { env } from '../config/env.js';

export function authMiddleware(): MiddlewareHandler {
  // If no AUTH_TOKEN configured, skip auth entirely
  if (!env.AUTH_TOKEN) {
    return async (_c, next) => { await next(); };
  }

  return bearerAuth({
    token: env.AUTH_TOKEN,
    noAuthenticationHeaderMessage: JSON.stringify({ error: 'Unauthorized' }),
    invalidAuthenticationHeaderMessage: JSON.stringify({ error: 'Unauthorized' }),
    invalidTokenMessage: JSON.stringify({ error: 'Unauthorized' }),
  });
}
```

**Important note on bearerAuth error responses:** The Hono `bearerAuth` middleware by default throws `HTTPException` with text messages. The user wants `{ "error": "Unauthorized" }` JSON. The `bearerAuth` options support custom error messages via `noAuthenticationHeaderMessage`, `invalidAuthenticationHeaderMessage`, and `invalidTokenMessage` -- but these are strings, not JSON objects. Since the app's global `onError` handler catches `HTTPException` and returns `c.json({ error: err.message })`, we need the messages to be just `"Unauthorized"` (not JSON-encoded). Alternatively, write a fully custom middleware using `c.req.header('Authorization')` for full control.

**Updated recommendation:** Write a simple custom auth middleware (~15 lines) instead of wrapping `bearerAuth`. This gives full control over response format and avoids the `bearerAuth` message format quirk:

```typescript
export function authMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (!env.AUTH_TOKEN) {
      await next();
      return;
    }
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== env.AUTH_TOKEN) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
}
```

### Pattern 2: SSRF URL Validation Before Fetch

**What:** Check URL hostname against private IP ranges before making HTTP request.
**When to use:** In `prefetchUrls()` before each `fetch()` call.

```typescript
// Source: OWASP SSRF Prevention (https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs)
import { isIP } from 'node:net';

const PRIVATE_RANGES_V4 = [
  { prefix: [127], mask: 8 },          // 127.0.0.0/8
  { prefix: [10], mask: 8 },           // 10.0.0.0/8
  { prefix: [172, 16], mask: 12 },     // 172.16.0.0/12
  { prefix: [192, 168], mask: 16 },    // 192.168.0.0/16
  { prefix: [169, 254], mask: 16 },    // 169.254.0.0/16
  { prefix: [0], mask: 8 },            // 0.0.0.0/8
];

export function isPrivateUrl(urlString: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return true; // Malformed URL = block
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }

  const hostname = parsed.hostname;

  // IPv6 loopback
  if (hostname === '[::1]' || hostname === '::1') return true;

  // Check if hostname is a raw IP address
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const octets = hostname.split('.').map(Number);
    return PRIVATE_RANGES_V4.some(range => {
      for (let i = 0; i < range.prefix.length; i++) {
        if (octets[i] !== range.prefix[i]) return false;
      }
      // For 172.16.0.0/12, need to check octets[1] is 16-31
      if (range.mask === 12 && range.prefix[0] === 172) {
        return octets[1] >= 16 && octets[1] <= 31;
      }
      return true;
    });
  }

  // Hostnames like "localhost" resolve to 127.0.0.1
  if (hostname === 'localhost') return true;

  return false;
}
```

**Key design choice:** The user decided no DNS rebinding check. This means we only check the hostname string, not the resolved IP. This is simpler but means a hostname like `evil.attacker.com` that resolves to `127.0.0.1` would bypass the check. Acceptable for a personal tool.

### Pattern 3: Sliding Window Rate Limiter

**What:** In-memory per-IP rate limiting with sliding window using a Map of timestamp arrays.
**When to use:** As middleware before all routes, with different limits for LLM vs non-LLM endpoints.

```typescript
const requestLog = new Map<string, number[]>();

function isRateLimited(ip: string, windowMs: number, maxRequests: number): boolean {
  const now = Date.now();
  const timestamps = requestLog.get(ip) ?? [];
  const windowStart = now - windowMs;

  // Remove timestamps outside window
  const valid = timestamps.filter(t => t > windowStart);
  valid.push(now);
  requestLog.set(ip, valid);

  return valid.length > maxRequests;
}
```

**Cleanup strategy (Claude's discretion):** Run a cleanup sweep every 5 minutes to evict IPs with no requests in the last 2 minutes. This prevents unbounded Map growth. Implement as `setInterval` in module scope with a `clearInterval` export for testing/shutdown.

```typescript
// Cleanup stale entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const STALE_THRESHOLD = 2 * 60 * 1000;

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - STALE_THRESHOLD;
  for (const [ip, timestamps] of requestLog) {
    const latest = timestamps[timestamps.length - 1];
    if (!latest || latest < cutoff) {
      requestLog.delete(ip);
    }
  }
}, CLEANUP_INTERVAL);

// Allow cleanup in tests / shutdown
export function stopRateLimiterCleanup() {
  clearInterval(cleanupTimer);
}
```

### Pattern 4: Response Size Limiting in Prefetch

**What:** Abort URL fetch if response exceeds 1 MB.
**When to use:** In `prefetchUrls()` to prevent memory exhaustion.

```typescript
const MAX_RESPONSE_BYTES = 1_048_576; // 1 MB

async function fetchWithSizeLimit(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });

  // Check Content-Length header first (fast path)
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
    return `[Content truncated at 1MB -- ${url}]`;
  }

  // Streaming fallback: read chunks and count bytes
  const reader = response.body?.getReader();
  if (!reader) return await response.text();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      reader.cancel();
      return `[Content truncated at 1MB -- ${url}]`;
    }
    chunks.push(value);
  }

  const decoder = new TextDecoder();
  return chunks.map(c => decoder.decode(c, { stream: true })).join('') + decoder.decode();
}
```

### Pattern 5: CORS Same-Origin Only

**What:** Configure Hono CORS middleware to block all cross-origin requests.
**When to use:** Global middleware on all routes.

The simplest approach to "same-origin only" is to **not use CORS middleware at all** -- since CORS headers are opt-in. Without CORS headers, browsers enforce same-origin policy by default. However, the user specifically wants Hono `cors()` middleware, so configure it to not emit permissive headers:

```typescript
// Source: Hono CORS docs (https://hono.dev/docs/middleware/builtin/cors)
import { cors } from 'hono/cors';

app.use(cors({
  origin: (origin) => {
    // Return empty string to deny -- Hono won't set Access-Control-Allow-Origin
    return '';
  },
}));
```

**Alternative (simpler, recommended):** Since the goal is to block cross-origin requests, simply omit the CORS middleware entirely. Without `Access-Control-Allow-Origin` headers, browsers block cross-origin requests by default. However, if the user explicitly wants it, use the callback returning empty string.

### Pattern 6: Middleware Mount Order in index.ts

**What:** Order of middleware matters for correct security behavior.
**Recommended order:**

```typescript
// 1. Request logging (already exists)
app.use(logger());

// 2. Security headers (before any response)
app.use(secureHeaders({ ... }));

// 3. CORS (before auth to handle preflight)
app.use(cors({ ... }));

// 4. Rate limiting (before auth to prevent auth brute force)
app.use(rateLimiter());

// 5. Auth (before routes)
app.use(authMiddleware());

// 6. Routes
app.route('/agents', createAgentRoutes(db));
// ...
```

**Rationale:**
- Security headers go first so every response gets them (even error responses)
- CORS before auth because preflight OPTIONS requests have no auth header
- Rate limiting before auth to throttle brute-force token guessing
- Auth before routes to protect all endpoints

### Anti-Patterns to Avoid

- **Leaking auth details:** Never return "invalid token" vs "missing token" -- always return generic `{ "error": "Unauthorized" }` (user decision)
- **IP detection via X-Forwarded-For without validation:** For a personal tool behind no reverse proxy, use Hono's `c.req.header('x-forwarded-for')` only if behind a trusted proxy; otherwise use connection IP
- **Regex-based URL validation for SSRF:** Use `URL` constructor (WHATWG API) instead of regex -- regex cannot safely handle URL edge cases
- **Blocking auth on health check:** Health endpoint should potentially be exempt from auth for monitoring tools (user hasn't specified this, so apply auth to all endpoints per decision)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bearer token parsing | Custom Authorization header parser | Hono `bearerAuth` or simple string split | Edge cases: whitespace, multiple spaces, empty token |
| Security response headers | Manual `c.header()` calls | Hono `secureHeaders()` | Covers HSTS, CORP, COOP and more by default |
| URL parsing for SSRF | Regex URL parser | `new URL()` (WHATWG) | Handles IPv6, ports, encoded chars, relative paths |
| IP version detection | Regex IP matching | `net.isIP()` from Node.js | Handles IPv4-mapped IPv6, edge cases |

**Key insight:** Hono's `secureHeaders()` sets many useful headers beyond just the three the user requested (X-Frame-Options, X-Content-Type-Options, Referrer-Policy). It also sets X-DNS-Prefetch-Control, X-Download-Options, Strict-Transport-Security, Cross-Origin-Resource-Policy, Cross-Origin-Opener-Policy by default. This is free security. Override only what differs from defaults (`xFrameOptions: 'DENY'` instead of default `'SAMEORIGIN'`, `referrerPolicy: 'same-origin'` instead of default `'no-referrer'`).

## Common Pitfalls

### Pitfall 1: Auth Middleware Blocking Preflight OPTIONS

**What goes wrong:** CORS preflight (OPTIONS) requests don't include Authorization header. If auth middleware runs first, preflights get 401.
**Why it happens:** Middleware order mistake.
**How to avoid:** Mount CORS middleware before auth middleware so preflight is handled first.
**Warning signs:** Browser console shows "CORS error" on preflight despite valid token.

### Pitfall 2: Rate Limiter IP Extraction on Localhost

**What goes wrong:** During development, all requests come from `127.0.0.1` or `::1`, causing rate limiting to trigger on the developer's own requests.
**Why it happens:** Single IP source in development.
**How to avoid:** Use a reasonable limit (60/min for general endpoints). In tests, expose `_resetRateLimiter()` for test isolation.
**Warning signs:** Tests fail intermittently due to rate limiting state leaking between test cases.

### Pitfall 3: SSRF Check Hostname Parsing Edge Cases

**What goes wrong:** `new URL('http://127.0.0.1:8080/path')` returns `hostname` as `"127.0.0.1"`, but `new URL('http://[::1]:8080/')` returns `hostname` as `"[::1]"` (with brackets).
**Why it happens:** WHATWG URL spec wraps IPv6 in brackets.
**How to avoid:** Check for both `"[::1]"` and `"::1"` in the IPv6 loopback check. Strip brackets before passing to `net.isIP()`.
**Warning signs:** IPv6 loopback URLs bypass SSRF check.

### Pitfall 4: Streaming Body Reader Not Available

**What goes wrong:** `response.body` can be `null` in some Node.js fetch implementations.
**Why it happens:** Some responses (204, HEAD) have no body.
**How to avoid:** Fallback to `response.text()` when `response.body` is null. The Content-Length header check still provides fast-path protection.
**Warning signs:** TypeError on `.getReader()`.

### Pitfall 5: Auth Token in Env Schema Requires Startup Restart

**What goes wrong:** Adding `AUTH_TOKEN` to the Zod env schema and then setting the env var requires a restart.
**Why it happens:** `env` is loaded once at import time.
**How to avoid:** This is expected behavior, not a bug. Document it. The auth middleware checks `env.AUTH_TOKEN` at middleware creation time (which is fine -- app restarts when env changes).
**Warning signs:** None -- expected behavior.

### Pitfall 6: `secureHeaders()` Default Overrides

**What goes wrong:** Using `secureHeaders({ xFrameOptions: 'DENY' })` only sets that one option -- other defaults are still applied.
**Why it happens:** Misunderstanding -- `secureHeaders` DOES keep defaults for unspecified options. Only explicitly set `false` disables a header.
**How to avoid:** Check defaults. `secureHeaders()` with no args already sets `X-Content-Type-Options: nosniff` (default). Only need to override `xFrameOptions` to `'DENY'` (default is `'SAMEORIGIN'`) and `referrerPolicy` to `'same-origin'` (default is `'no-referrer'`).
**Warning signs:** Extra headers appearing in responses that weren't configured.

## Code Examples

### Adding AUTH_TOKEN to env schema

```typescript
// src/config/env.ts -- add to envSchema object
AUTH_TOKEN: z.string().optional(),
```

### Input field limits on Zod schema

```typescript
// src/schemas/agent-input.ts
export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  taskDescription: z.string().min(1).max(10_000),
  cronSchedule: z.string().min(1).max(500),
  systemPrompt: z.string().max(5_000).optional(),
  model: z.string().max(100).optional(),
  enabled: z.boolean().optional(),
});
```

### Hono secureHeaders configuration

```typescript
// Source: https://hono.dev/docs/middleware/builtin/secure-headers
import { secureHeaders } from 'hono/secure-headers';

app.use(secureHeaders({
  xFrameOptions: 'DENY',               // Override default 'SAMEORIGIN'
  xContentTypeOptions: 'nosniff',       // Same as default (explicit for clarity)
  referrerPolicy: 'same-origin',        // Override default 'no-referrer'
  // Defaults also set: HSTS, CORP, COOP, X-DNS-Prefetch-Control, etc.
}));
```

### Getting client IP in Hono (for rate limiting)

```typescript
// Hono provides c.req.header() for headers
// For a personal tool not behind a proxy, use connection info
function getClientIp(c: Context): string {
  // Check X-Forwarded-For first (if behind proxy)
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  // Fallback: Hono on Node.js can access the raw request
  // The @hono/node-server adapter provides the remote address
  // via c.env.incoming (the raw IncomingMessage)
  const incoming = c.env?.incoming;
  return incoming?.socket?.remoteAddress ?? '127.0.0.1';
}
```

**Important:** In Hono with `@hono/node-server`, the raw Node.js `IncomingMessage` is available at `c.env.incoming`. The `remoteAddress` is on `c.env.incoming.socket.remoteAddress`. This is the most reliable way to get the client IP for rate limiting in the non-proxied personal tool use case.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual CORS headers | Hono `cors()` middleware | Hono 3.x+ | No need to manually set Access-Control-* headers |
| Manual security headers | Hono `secureHeaders()` | Hono 3.x+ | Comprehensive defaults, single line |
| External SSRF libraries (ssrf, nossrf) | Custom validation with URL + net.isIP | 2025 (CVEs in libraries) | Avoid third-party SSRF libs with known bypass CVEs |
| External rate limiting packages | Simple in-memory Map | N/A (personal tool) | Zero dependencies, adequate for single-process |

**Deprecated/outdated:**
- `node:url` `url.parse()` -- use `new URL()` (WHATWG) instead
- `ssrf-req-filter` npm package -- CVE-2025-2691 bypass vulnerability found in `nossrf`
- `ip` npm package `isPublic()` -- known bypass via hex/octal IP notation

## Open Questions

1. **Hono `c.env.incoming` type safety**
   - What we know: `@hono/node-server` puts the raw IncomingMessage on `c.env.incoming`
   - What's unclear: Whether TypeScript types expose this correctly without type assertion
   - Recommendation: Use type assertion `(c.env as any).incoming?.socket?.remoteAddress` or define a custom Hono env type. For a personal tool, the type assertion is acceptable.

2. **Rate limiter behavior for LLM-specific paths**
   - What we know: Different rate limits for `/agents/:id/execute` and `/schedules/parse` (10/min) vs all others (60/min)
   - What's unclear: How to cleanly detect "LLM-invoking" paths in a single middleware vs mounting separate middleware
   - Recommendation: Use `c.req.path` matching in a single middleware. Check if path matches `/agents/*/execute` or `/schedules/parse`. Use Hono path matching or simple string includes.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm vitest run tests/{file}.test.ts` |
| Full suite command | `pnpm vitest run` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | Auth middleware blocks requests without valid token when AUTH_TOKEN set | unit | `pnpm vitest run tests/middleware-auth.test.ts -t "blocks"` | Wave 0 |
| SEC-02 | Auth middleware passes through when AUTH_TOKEN not set | unit | `pnpm vitest run tests/middleware-auth.test.ts -t "skips"` | Wave 0 |
| SEC-03 | SSRF check blocks private IPs (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, ::1) | unit | `pnpm vitest run tests/ssrf.test.ts` | Wave 0 |
| SEC-04 | Prefetch aborts at 1 MB response body | unit | `pnpm vitest run tests/prefetch.test.ts -t "size limit"` | Wave 0 |
| SEC-05 | Input field limits enforce max lengths via Zod | unit | `pnpm vitest run tests/schemas.test.ts -t "max"` | Wave 0 |
| SEC-06 | Rate limiter returns 429 after threshold exceeded | unit | `pnpm vitest run tests/middleware-rate-limiter.test.ts` | Wave 0 |
| SEC-07 | Security headers present on all responses | unit | `pnpm vitest run tests/middleware-security.test.ts -t "headers"` | Wave 0 |
| SEC-08 | CORS blocks cross-origin requests (no Access-Control-Allow-Origin: *) | unit | `pnpm vitest run tests/middleware-security.test.ts -t "cors"` | Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm vitest run tests/middleware-auth.test.ts tests/ssrf.test.ts tests/middleware-rate-limiter.test.ts tests/middleware-security.test.ts`
- **Per wave merge:** `pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/middleware-auth.test.ts` -- covers SEC-01, SEC-02
- [ ] `tests/ssrf.test.ts` -- covers SEC-03 (isPrivateUrl function)
- [ ] `tests/middleware-rate-limiter.test.ts` -- covers SEC-06
- [ ] `tests/middleware-security.test.ts` -- covers SEC-07, SEC-08
- [ ] Additional test cases in existing `tests/prefetch.test.ts` -- covers SEC-04
- [ ] Additional test cases in existing `tests/schemas.test.ts` -- covers SEC-05

## Sources

### Primary (HIGH confidence)

- [Hono Bearer Auth Middleware docs](https://hono.dev/docs/middleware/builtin/bearer-auth) -- API, options, error behavior
- [Hono CORS Middleware docs](https://hono.dev/docs/middleware/builtin/cors) -- origin callback API, same-origin config
- [Hono Secure Headers Middleware docs](https://hono.dev/docs/middleware/builtin/secure-headers) -- default values, override options
- [Hono Testing docs](https://hono.dev/docs/guides/testing) -- app.request() with headers for middleware testing
- Existing codebase (`src/index.ts`, `src/services/prefetch.ts`, `src/schemas/agent-input.ts`, `src/config/env.ts`) -- integration points verified

### Secondary (MEDIUM confidence)

- [OWASP SSRF Prevention in Node.js](https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs) -- URL parsing, IP classification, private ranges
- [npm `nossrf` CVE-2025-2691](https://security.snyk.io/vuln/SNYK-JS-NOSSRF-9510842) -- evidence that third-party SSRF libs have bypass vulnerabilities
- [npm `ip` package CVE](https://github.com/indutny/node-ip/issues/150) -- evidence that `isPublic()` has known bypass via hex notation

### Tertiary (LOW confidence)

- Client IP extraction via `c.env.incoming.socket.remoteAddress` -- based on `@hono/node-server` internals, not officially documented API (may need verification during implementation)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed, Hono middleware verified via official docs
- Architecture: HIGH -- middleware patterns are standard Hono, integration points verified in existing code
- Pitfalls: HIGH -- CORS/preflight ordering is well-known, SSRF hostname parsing tested against WHATWG URL spec
- SSRF implementation: MEDIUM -- custom implementation without DNS rebinding check (user decision); IP range validation logic is straightforward but hostname edge cases exist

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable -- Hono middleware API is mature, security patterns don't change rapidly)
