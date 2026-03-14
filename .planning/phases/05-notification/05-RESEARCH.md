# Phase 5: Notification - Research

**Researched:** 2026-03-14
**Domain:** Email delivery via Resend SDK
**Confidence:** HIGH

## Summary

Phase 5 adds email notification after successful agent executions using the Resend email service. The scope is narrow: a single `sendNotification` function that takes an agent name, timestamp, and `AgentOutput`, composes an HTML email, and sends it via Resend. The function is called fire-and-forget from the executor after a successful run, and updates the `deliveryStatus` column (already exists in the schema) to `pending`, `sent`, or `failed`.

The Resend Node.js SDK (`resend` npm package) provides a clean `emails.send()` API that returns `{ data, error }` rather than throwing exceptions, which aligns perfectly with the "failures don't crash execution" requirement. The SDK is lightweight, TypeScript-native, and requires no additional dependencies beyond `resend` itself.

**Primary recommendation:** Create `src/services/notifier.ts` as a plain function that conditionally sends email (skipping silently when env vars are missing), call it from `executeAgent` after the success DB update, and update `deliveryStatus` on the execution record independently.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Subject line: "[Schedoodle] Agent Name -- Summary" (e.g., "[Schedoodle] Morning Briefing -- 3 key items found")
- HTML email with clean layout: header (agent name + timestamp), summary section, details section
- If the output has a data field, render it as a formatted JSON code block at the bottom
- Only send emails on successful executions -- no failure notifications
- Single recipient via NOTIFICATION_EMAIL env var (personal tool, one user)
- Sender address via NOTIFICATION_FROM env var (Resend requires verified domain)
- RESEND_API_KEY env var for Resend authentication
- Notification is optional -- if NOTIFICATION_EMAIL or RESEND_API_KEY is missing, skip email delivery silently
- deliveryStatus values: pending / sent / failed (three states)
- Set to 'pending' before sending, update to 'sent' on success or 'failed' on Resend error
- No retry on failure -- log the error and continue
- Delivery failures never mark the execution as failed

### Claude's Discretion
- Resend SDK usage patterns
- HTML template styling
- How the notifier is called from the executor (after DB update, fire-and-forget)
- Whether to add env vars as optional to Zod schema or handle separately

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NOTF-01 | Agent results are delivered via email after each successful execution | Resend SDK `emails.send()` called from executor after success path; deliveryStatus tracking on execution record; fire-and-forget pattern ensures execution is not blocked |
| NOTF-02 | Emails include the agent name, execution timestamp, and formatted results | HTML template with header (agent name + timestamp), summary section, details section, optional JSON data block; subject line format locked |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| resend | ^4.x (latest) | Email delivery API | Official Node.js SDK, TypeScript-native, returns {data, error} not exceptions, 2 req/s rate limit, simple API |

### Supporting
No additional libraries needed. HTML is built as a template string -- no templating engine required for a single, simple email layout.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| resend | nodemailer | Nodemailer requires SMTP config; Resend is API-based, simpler for this use case. User locked Resend. |
| Template strings | React Email | Overkill for one template; adds React dependency for email rendering |

**Installation:**
```bash
pnpm add resend
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  services/
    notifier.ts          # NEW: sendNotification() function
    executor.ts          # MODIFIED: call notifier after success
  config/
    env.ts               # MODIFIED: add optional email env vars
tests/
  notifier.test.ts       # NEW: unit tests for notifier
  executor.test.ts       # MODIFIED: verify notifier integration
```

### Pattern 1: Conditional Notifier with Fire-and-Forget
**What:** The notifier checks for env vars at call time. If missing, returns early (no-op). If present, sends email and returns delivery result. The executor calls it after the success DB update and uses the result to set deliveryStatus -- but never lets a notifier error propagate.
**When to use:** Always -- this is the only notification pattern.
**Example:**
```typescript
// src/services/notifier.ts
import { Resend } from "resend";
import { env } from "../config/env.js";
import type { AgentOutput } from "../schemas/agent-output.js";

export interface NotifyResult {
  status: "sent" | "failed" | "skipped";
  error?: string;
}

export async function sendNotification(
  agentName: string,
  executedAt: string,
  output: AgentOutput,
): Promise<NotifyResult> {
  // Skip silently if not configured
  if (!env.RESEND_API_KEY || !env.NOTIFICATION_EMAIL) {
    return { status: "skipped" };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const html = buildEmailHtml(agentName, executedAt, output);
  const subject = `[Schedoodle] ${agentName} — ${output.summary}`;

  const { error } = await resend.emails.send({
    from: env.NOTIFICATION_FROM ?? `Schedoodle <noreply@${env.NOTIFICATION_EMAIL.split("@")[1]}>`,
    to: env.NOTIFICATION_EMAIL,
    subject,
    html,
  });

  if (error) {
    console.error(`[notify] Failed to send email for ${agentName}: ${error.message}`);
    return { status: "failed", error: error.message };
  }

  return { status: "sent" };
}
```

### Pattern 2: Executor Integration
**What:** After the success DB update in `executeAgent`, call `sendNotification` in a try/catch and update `deliveryStatus` on the execution record.
**Example:**
```typescript
// In executor.ts, after the success update block:
try {
  const notifyResult = await sendNotification(agent.name, new Date().toISOString(), output);
  if (notifyResult.status !== "skipped") {
    db.update(executionHistory)
      .set({ deliveryStatus: notifyResult.status === "sent" ? "sent" : "failed" })
      .where(eq(executionHistory.id, executionId))
      .run();
  }
} catch (err) {
  // Never let notification errors affect execution status
  console.error(`[notify] Unexpected error: ${err}`);
  db.update(executionHistory)
    .set({ deliveryStatus: "failed" })
    .where(eq(executionHistory.id, executionId))
    .run();
}
```

### Pattern 3: Optional Env Vars in Zod Schema
**What:** Add RESEND_API_KEY, NOTIFICATION_EMAIL, and NOTIFICATION_FROM as optional strings in the existing Zod env schema.
**Example:**
```typescript
// In env.ts, add to envSchema:
RESEND_API_KEY: z.string().optional(),
NOTIFICATION_EMAIL: z.string().email().optional(),
NOTIFICATION_FROM: z.string().optional(),
```

### Anti-Patterns to Avoid
- **Creating Resend client at module level:** If env vars aren't set, this would error or create an unusable client. Create it at call time inside `sendNotification`.
- **Throwing on send failure:** The Resend SDK returns `{ data, error }` -- don't wrap in try/catch for the send itself. The `error` field IS the failure signal.
- **Setting deliveryStatus to 'pending' before the send call:** The context says to set pending before sending. Do this with a DB update before the `resend.emails.send()` call, then update to sent/failed after. However, given this is a fast API call and we want to minimize DB writes, an alternative is to only write the final status. Given the user explicitly specified the "pending before sending" flow, follow it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email delivery | SMTP client, HTTP calls to email APIs | `resend` npm package | Handles authentication, rate limiting, error formatting |
| HTML email rendering | Complex template engine | Template literal function | Single template, no dynamic partials needed |
| Email validation | Regex for NOTIFICATION_EMAIL | Zod `.email()` | Already using Zod for env validation |

**Key insight:** This phase is intentionally simple. The Resend SDK does the heavy lifting. The notifier is ~50 lines of code plus an HTML template function.

## Common Pitfalls

### Pitfall 1: Resend SDK Returns Errors, Not Exceptions
**What goes wrong:** Wrapping `resend.emails.send()` in try/catch and missing the `{ error }` response.
**Why it happens:** Most SDKs throw on failure. Resend returns a result object.
**How to avoid:** Always destructure `{ data, error }` from the send result. Check `error` before assuming success.
**Warning signs:** Emails silently "succeed" (no error thrown) but never arrive.

### Pitfall 2: Subject Line Truncation
**What goes wrong:** If `output.summary` is very long, the subject line becomes unwieldy.
**Why it happens:** LLM output is unpredictable in length.
**How to avoid:** Truncate summary in subject to ~80 chars with ellipsis.
**Warning signs:** Email clients showing broken subject lines.

### Pitfall 3: HTML Injection in Email Body
**What goes wrong:** Agent output containing HTML tags gets rendered as HTML in the email.
**Why it happens:** Inserting raw LLM output into HTML template.
**How to avoid:** Escape HTML entities in summary and details before inserting into template. The `data` field is JSON-stringified so it's safe in a `<pre>` block.
**Warning signs:** Broken email layout, potential XSS in web-based email clients.

### Pitfall 4: Missing NOTIFICATION_FROM Fallback
**What goes wrong:** Resend requires a verified domain for the `from` address. If NOTIFICATION_FROM isn't set and the fallback domain isn't verified, sends fail.
**Why it happens:** Resend doesn't allow arbitrary from addresses.
**How to avoid:** Make NOTIFICATION_FROM required when RESEND_API_KEY is set, OR document clearly that the user must set it. Given the context says it's a separate env var, require it alongside RESEND_API_KEY.
**Warning signs:** All emails fail with "domain not verified" errors.

## Code Examples

### HTML Email Template
```typescript
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmailHtml(agentName: string, executedAt: string, output: AgentOutput): string {
  const timestamp = new Date(executedAt).toLocaleString();
  const dataSection = output.data
    ? `<h3>Data</h3><pre style="background:#f4f4f4;padding:12px;border-radius:4px;overflow-x:auto;">${escapeHtml(JSON.stringify(output.data, null, 2))}</pre>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:20px;">
    <h1 style="margin:0;font-size:20px;">${escapeHtml(agentName)}</h1>
    <p style="margin:4px 0 0;color:#666;font-size:14px;">${timestamp}</p>
  </div>
  <div style="margin-bottom:20px;">
    <h2 style="font-size:16px;margin:0 0 8px;">Summary</h2>
    <p style="margin:0;">${escapeHtml(output.summary)}</p>
  </div>
  <div style="margin-bottom:20px;">
    <h2 style="font-size:16px;margin:0 0 8px;">Details</h2>
    <p style="margin:0;white-space:pre-wrap;">${escapeHtml(output.details)}</p>
  </div>
  ${dataSection}
</body>
</html>`;
}
```

### Resend SDK Send Pattern
```typescript
// Source: https://resend.com/docs/send-with-nodejs
import { Resend } from "resend";

const resend = new Resend("re_123456789");
const { data, error } = await resend.emails.send({
  from: "Schedoodle <notifications@yourdomain.com>",
  to: "user@example.com",
  subject: "[Schedoodle] Agent Name — Summary text",
  html: "<h1>Hello</h1>",
});

// data = { id: "msg_xxx" } on success
// error = { message: "...", name: "..." } on failure
```

### Test Pattern: Mocking Resend
```typescript
// Mock the resend module
const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

// In test:
mockSend.mockResolvedValue({ data: { id: "msg_123" }, error: null });
// or for failure:
mockSend.mockResolvedValue({ data: null, error: { message: "Domain not verified", name: "validation_error" } });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Nodemailer + SMTP | Resend API-based SDK | 2023+ | No SMTP config, simpler setup, TypeScript-native |
| React Email templates | Plain HTML strings | N/A (project decision) | Simpler for single template, no React dependency |

**Deprecated/outdated:**
- Nothing relevant -- Resend SDK is actively maintained, API is stable.

## Open Questions

1. **NOTIFICATION_FROM fallback behavior**
   - What we know: User specified NOTIFICATION_FROM as a separate env var. Resend requires verified domain.
   - What's unclear: Should we require NOTIFICATION_FROM when RESEND_API_KEY is set, or provide a fallback?
   - Recommendation: Require all three env vars together (RESEND_API_KEY + NOTIFICATION_EMAIL + NOTIFICATION_FROM). If any is missing, skip notification. This avoids complex fallback logic and failed sends due to unverified domains.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NOTF-01 | sendNotification sends email on success, skips when env vars missing, returns sent/failed/skipped | unit | `pnpm vitest run tests/notifier.test.ts -t "send"` | No -- Wave 0 |
| NOTF-01 | Delivery failure does not affect execution status | unit | `pnpm vitest run tests/executor.test.ts -t "delivery"` | Partially (executor.test.ts exists, needs new tests) |
| NOTF-02 | Email includes agent name, timestamp, formatted results | unit | `pnpm vitest run tests/notifier.test.ts -t "html"` | No -- Wave 0 |
| NOTF-02 | Data field rendered as JSON when present | unit | `pnpm vitest run tests/notifier.test.ts -t "data"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/notifier.test.ts` -- covers NOTF-01, NOTF-02 (mock Resend SDK, test HTML output, test skip behavior)
- [ ] Updated `tests/executor.test.ts` -- covers NOTF-01 delivery isolation (mock notifier, verify deliveryStatus updates)

## Sources

### Primary (HIGH confidence)
- [Resend official docs](https://resend.com/docs/send-with-nodejs) -- SDK API, send method signature, error handling pattern
- [npm: resend](https://www.npmjs.com/package/resend) -- current version, installation

### Secondary (MEDIUM confidence)
- Existing codebase analysis -- executor.ts, schema.ts, env.ts patterns verified by direct file reads

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Resend SDK is well-documented, API verified from official docs
- Architecture: HIGH -- integration points are clear from existing codebase (executor returns discriminated union, deliveryStatus column exists)
- Pitfalls: HIGH -- error handling pattern is documented, HTML escaping is standard practice

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable domain, Resend SDK API unlikely to change)
