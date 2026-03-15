# Phase 15: Telegram Notification Channel - Research

**Researched:** 2026-03-15
**Domain:** Telegram Bot API integration, multi-channel notification dispatch
**Confidence:** HIGH

## Summary

Phase 15 adds Telegram as a second notification channel alongside existing email (Resend/SMTP). The Telegram Bot API is a simple HTTP REST API -- sending a message is a single POST to `https://api.telegram.org/bot<token>/sendMessage`. No third-party library is needed; Node.js built-in `fetch` is sufficient. The main technical complexity lies in MarkdownV2 escaping (17 special characters must be escaped outside formatting entities) and refactoring the executor's notification dispatch to support parallel multi-channel delivery with per-channel status tracking.

The existing notifier.ts follows a clean pattern: transport-specific `sendVia*()` functions called from `sendNotification()` and `sendFailureNotification()`. Adding `sendViaTelegram()` follows the same shape. The executor.ts fire-and-forget notification section needs rework to dispatch both channels via `Promise.allSettled` and write per-channel delivery status.

**Primary recommendation:** Use direct `fetch` calls to the Telegram Bot API (no library), implement a `escapeTelegramMarkdownV2()` utility function, refactor executor notification dispatch to parallel multi-channel with per-channel DB status columns.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Both channels fire independently -- if Telegram is configured, send to Telegram; if email is configured, send email
- Telegram configured via two env vars: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (same pattern as email's RESEND_API_KEY + NOTIFICATION_EMAIL)
- Skip Telegram silently if either env var is missing (matches Phase 5 email pattern)
- Both channels dispatch in parallel via Promise.allSettled -- neither blocks the other
- Per-channel delivery status columns: separate tracking for email and Telegram
- Add telegramDeliveryStatus column to executionHistory
- Existing deliveryStatus column migration approach is Claude's discretion (rename vs keep + add)
- Telegram MarkdownV2 format for structured output
- Message structure: bold agent name, timestamp, summary section, details section
- Data field rendered as code block if present
- Truncate at ~3800 chars (room for header), append "... [truncated, see email for full output]"
- Failure messages use warning emoji prefix and "FAILED:" in header
- Disable link previews (disable_web_page_preview=true) -- agent outputs often contain URLs
- Normal notification sound (no disable_notification)
- Add sendViaTelegram() alongside existing sendViaSmtp()/sendViaResend() in notifier.ts -- no channel abstraction refactor
- Both success and failure executions trigger Telegram messages (matches email behavior)
- Add test_telegram MCP tool for setup verification
- Health endpoint shows per-channel delivery stats (email and Telegram success/failure counts)

### Claude's Discretion
- Telegram Bot API client approach (direct HTTP fetch vs library)
- Retry behavior on Telegram delivery failure
- deliveryStatus column migration strategy (rename existing vs keep + add new)
- Exact MarkdownV2 escaping implementation
- Test strategy for Telegram notification (mocking approach)

### Deferred Ideas (OUT OF SCOPE)
- Per-agent notification channel configuration (choose email, Telegram, or both per agent) -- future phase
- Notification channel abstraction/interface pattern -- revisit if a third channel is added
- Telegram inline keyboard buttons for agent actions (re-run, disable) -- future enhancement
- Silent mode toggle per agent -- future enhancement
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `fetch` | (built-in) | HTTP client for Telegram Bot API | Zero dependencies, API is a single POST endpoint |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | - | - | No additional dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Built-in fetch | node-telegram-bot-api | Full bot framework with polling/webhooks, massive overkill for send-only |
| Built-in fetch | telegraf | Framework-oriented, adds ~2MB for a single sendMessage call |
| Built-in fetch | telegram-markdown-v2 | 0.0.4, 4 dependents, trivial to hand-roll the 17-char escape |

**Recommendation (Claude's Discretion: API client approach):** Use built-in `fetch` directly. The Telegram Bot API is a simple REST API. Sending a message is one POST with a JSON body. Adding a library dependency for this is unjustified given the project's existing pattern of minimal dependencies (custom circuit breaker, custom semaphore, etc.).

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── services/
│   └── notifier.ts            # Add sendViaTelegram(), buildTelegramMarkdown(), buildTelegramFailureMarkdown()
│   └── telegram.ts            # (NEW) escapeTelegramMarkdownV2(), sendTelegramMessage() low-level API call
├── config/
│   └── env.ts                 # Add TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID as optional strings
├── db/
│   └── schema.ts              # Add telegramDeliveryStatus column, rename deliveryStatus -> emailDeliveryStatus
├── routes/
│   └── health.ts              # Add per-channel delivery stats
├── mcp/
│   └── tools/
│       └── health.ts          # Add per-channel stats to MCP health
│       └── telegram.ts        # (NEW) test_telegram MCP tool
└── mcp.ts                     # Register test_telegram tool
```

### Pattern 1: Direct Telegram Bot API Call
**What:** POST to `https://api.telegram.org/bot<token>/sendMessage` with JSON body
**When to use:** Every Telegram message send
**Example:**
```typescript
// Source: https://core.telegram.org/bots/api#sendmessage
async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; description?: string }> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
      link_preview_options: { is_disabled: true },
    }),
  });
  return res.json() as Promise<{ ok: boolean; description?: string }>;
}
```

### Pattern 2: MarkdownV2 Escaping
**What:** Escape 18 special characters outside formatting entities
**When to use:** All user-generated text in Telegram messages
**Example:**
```typescript
// Source: https://core.telegram.org/bots/api#markdownv2-style
// Characters that MUST be escaped outside formatting entities:
// _ * [ ] ( ) ~ ` > # + - = | { } . ! \
function escapeTelegramMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
```

### Pattern 3: Multi-Channel Parallel Dispatch
**What:** Fire email and Telegram notifications in parallel, track status independently
**When to use:** After each execution completes (success or failure)
**Example:**
```typescript
// In executor.ts notification section
const [emailResult, telegramResult] = await Promise.allSettled([
  sendEmailNotification(agentName, executedAt, output),
  sendTelegramNotification(agentName, executedAt, output),
]);

// Update per-channel delivery status independently
const emailStatus = emailResult.status === "fulfilled"
  ? emailResult.value.status : "failed";
const telegramStatus = telegramResult.status === "fulfilled"
  ? telegramResult.value.status : "failed";

db.update(executionHistory)
  .set({
    emailDeliveryStatus: emailStatus === "skipped" ? null : emailStatus,
    telegramDeliveryStatus: telegramStatus === "skipped" ? null : telegramStatus,
  })
  .where(eq(executionHistory.id, executionId))
  .run();
```

### Pattern 4: Telegram Message Formatting
**What:** Build structured MarkdownV2 messages for agent results
**When to use:** Success and failure notification messages
**Example:**
```typescript
function buildTelegramMarkdown(
  agentName: string,
  executedAt: string,
  output: AgentOutput,
): string {
  const esc = escapeTelegramMarkdownV2;
  const timestamp = new Date(executedAt).toLocaleString();
  const parts: string[] = [
    `*${esc(agentName)}*`,
    esc(timestamp),
    "",
    `*Summary*`,
    esc(output.summary),
    "",
    `*Details*`,
    esc(output.details),
  ];

  if (output.data) {
    parts.push("", `*Data*`, `\`\`\`\n${output.data}\n\`\`\``);
  }

  let message = parts.join("\n");
  if (message.length > 3800) {
    message = message.slice(0, 3800) + "\n\\.\\.\\. \\[truncated, see email for full output\\]";
  }
  return message;
}
```

### Anti-Patterns to Avoid
- **Pulling in a Telegram bot library:** node-telegram-bot-api, telegraf, etc. are framework-sized for a single sendMessage call. The project convention is minimal dependencies.
- **Sequential channel dispatch:** Email then Telegram (or vice versa) means one slow channel delays the other. Always use `Promise.allSettled`.
- **Shared delivery status column:** Cramming both channels into one column loses information. Use separate columns.
- **Using deprecated `disable_web_page_preview`:** Use `link_preview_options: { is_disabled: true }` instead (changed in Bot API 7.0, December 2023).
- **Forgetting to escape inside code blocks:** Inside `` ` `` and `pre` blocks, only `` ` `` and `\` need escaping, NOT the full 18-character set.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client | Custom HTTP wrapper | Built-in `fetch` | One endpoint, one method, built-in is perfect |
| JSON parsing | Manual response parsing | `res.json()` | Standard, type-safe enough with a cast |

**Key insight:** This phase is almost entirely hand-rolled code by design. The Telegram Bot API is so simple that wrapping it in a library adds more complexity than it removes. The main engineering challenge is the escaping function and the executor refactor, not the API call itself.

## Common Pitfalls

### Pitfall 1: MarkdownV2 Escaping Errors
**What goes wrong:** Message fails to send with `400 Bad Request: can't parse entities` because a special character wasn't escaped.
**Why it happens:** MarkdownV2 requires escaping 18 characters: `_ * [ ] ( ) ~ ` > # + - = | { } . ! \`. Agent output text can contain any of these.
**How to avoid:** Apply `escapeTelegramMarkdownV2()` to ALL user-generated text. Do NOT escape formatting markers you intentionally use (like `*bold*`). Build the message by escaping content first, then wrapping with formatting.
**Warning signs:** Test messages work but real agent outputs fail intermittently.

### Pitfall 2: Code Block Escaping Mismatch
**What goes wrong:** Code block content gets double-escaped or breaks formatting.
**Why it happens:** Inside `` ``` `` pre blocks, only `` ` `` and `\` need escaping. The full 18-char escape applied to code block content will over-escape.
**How to avoid:** Use a separate `escapeCodeBlock()` function for content inside pre/code blocks that only escapes `` ` `` and `\`.
**Warning signs:** Code blocks render with visible backslashes before dots, brackets, etc.

### Pitfall 3: Message Length Overflow
**What goes wrong:** Telegram rejects messages over 4096 UTF-8 characters with `400 Bad Request: message is too long`.
**Why it happens:** Agent output can be very long. The 4096 limit is after entity parsing.
**How to avoid:** Truncate at ~3800 characters (as decided in CONTEXT.md) to leave room for header, formatting markers, and the truncation notice. Measure the final composed message, not just the content.
**Warning signs:** Long agent outputs produce send failures.

### Pitfall 4: link_preview_options vs disable_web_page_preview
**What goes wrong:** Using deprecated `disable_web_page_preview` parameter. It still works today but may stop working.
**Why it happens:** Many tutorials and examples use the old parameter.
**How to avoid:** Use `link_preview_options: { is_disabled: true }` (Bot API 7.0+, December 2023).
**Warning signs:** Telegram API warnings or future breakage.

### Pitfall 5: deliveryStatus Column Migration
**What goes wrong:** Renaming `deliveryStatus` to `emailDeliveryStatus` breaks existing queries or loses data.
**Why it happens:** SQLite ALTER TABLE has limited support for column renames.
**How to avoid:** Preferred strategy: keep existing `deliveryStatus` column (rename conceptually in code to `emailDeliveryStatus` via Drizzle column alias) and add new `telegramDeliveryStatus` column. Or rename via Drizzle Kit push (which handles SQLite column renames since drizzle-kit 0.22+). Use `db:push` which the project already uses.
**Warning signs:** Migration fails or existing data is lost.

### Pitfall 6: Executor Notification Refactor Breaking Existing Tests
**What goes wrong:** Changing the notification dispatch in executor.ts breaks the existing 15+ notification-related tests in executor.test.ts.
**Why it happens:** Tests mock `sendNotification` and `sendFailureNotification` and assert specific call patterns and deliveryStatus values.
**How to avoid:** The notifier mock in executor.test.ts needs to be updated to return a multi-channel result shape, or the existing functions need to be preserved with the same signatures while adding Telegram internally.
**Warning signs:** Existing tests fail after refactor.

## Code Examples

Verified patterns from the existing codebase and official Telegram docs:

### Telegram sendMessage API Call
```typescript
// Source: https://core.telegram.org/bots/api#sendmessage
const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; description?: string }> {
  const url = `${TELEGRAM_API_BASE}${botToken}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
      link_preview_options: { is_disabled: true },
    }),
  });

  const data = (await response.json()) as { ok: boolean; description?: string };
  return data;
}
```

### MarkdownV2 Escape Functions
```typescript
// Source: https://core.telegram.org/bots/api#markdownv2-style
// Full escape for text outside formatting entities
export function escapeMdV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// Escape for text inside pre/code blocks (only ` and \ need escaping)
export function escapeMdV2CodeBlock(text: string): string {
  return text.replace(/([`\\])/g, "\\$1");
}
```

### Env Schema Addition
```typescript
// Source: existing src/config/env.ts pattern
// Add to envSchema .object():
TELEGRAM_BOT_TOKEN: z.string().optional(),
TELEGRAM_CHAT_ID: z.string().optional(),
```

### Schema Column Addition
```typescript
// Source: existing src/db/schema.ts pattern
// Add to executionHistory table:
telegramDeliveryStatus: text("telegram_delivery_status"),
// Optionally rename deliveryStatus -> emailDeliveryStatus in Drizzle mapping:
emailDeliveryStatus: text("delivery_status"),  // keep DB column name, rename TS field
```

### sendViaTelegram Following Existing Pattern
```typescript
// Source: existing sendViaSmtp/sendViaResend pattern in notifier.ts
async function sendViaTelegram(
  botToken: string,
  chatId: string,
  text: string,
): Promise<NotifyResult> {
  try {
    const result = await sendTelegramMessage(botToken, chatId, text);
    if (!result.ok) {
      console.error(`[notify] Telegram error: ${result.description}`);
      return { status: "failed", error: result.description };
    }
    return { status: "sent" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[notify] Telegram error: ${message}`);
    return { status: "failed", error: message };
  }
}
```

### MCP test_telegram Tool
```typescript
// Source: existing MCP tool registration pattern in src/mcp/tools/*.ts
server.registerTool(
  "test_telegram",
  {
    title: "Test Telegram",
    description: "Send a test message to verify Telegram bot configuration is working.",
    inputSchema: z.object({}),
  },
  async () => {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      return errorResponse(
        "Telegram not configured",
        "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables.",
      );
    }

    const result = await sendTelegramMessage(
      botToken,
      chatId,
      escapeMdV2("Hello from Schedoodle! Telegram notifications are working."),
    );

    if (!result.ok) {
      return errorResponse(
        `Telegram API error: ${result.description}`,
        "Check your TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID values.",
      );
    }

    return jsonResponse({ status: "sent", message: "Test message delivered successfully." });
  },
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `disable_web_page_preview: true` | `link_preview_options: { is_disabled: true }` | Bot API 7.0 (Dec 2023) | Old param still works but deprecated |
| `reply_to_message_id` param | `reply_parameters` object | Bot API 7.0 (Dec 2023) | Not relevant for this phase |
| Markdown parse_mode | MarkdownV2 parse_mode | Bot API 4.5 (2019) | Original Markdown is legacy, use MarkdownV2 |

**Deprecated/outdated:**
- `disable_web_page_preview`: Replaced by `link_preview_options` in Bot API 7.0. Still accepted but use new API.
- `Markdown` parse_mode: Legacy. Use `MarkdownV2` for all new code.

## Telegram Bot API Quick Reference

| Property | Value |
|----------|-------|
| Base URL | `https://api.telegram.org/bot<token>/sendMessage` |
| Method | POST with JSON body |
| Max message length | 4096 UTF-8 characters (after entity parsing) |
| Rate limit (single chat) | ~1 msg/second sustained, bursts tolerated |
| Rate limit (global) | 30 msg/second across all chats |
| Parse mode | `MarkdownV2` |
| Disable previews | `link_preview_options: { is_disabled: true }` |
| Response shape | `{ ok: boolean, result?: Message, description?: string, error_code?: number }` |
| 429 response | Includes `retry_after` field (seconds to wait) |

## Discretion Recommendations

### Telegram Bot API Client Approach
**Recommendation:** Direct `fetch`. Zero dependencies, one function, matches project convention of minimal deps.

### Retry Behavior on Telegram Delivery Failure
**Recommendation:** No retry on first implementation. The notification is fire-and-forget (matching email pattern). If the Telegram API returns an error, log it and mark `telegramDeliveryStatus` as `"failed"`. Retries add complexity (retry timing, idempotency) for a notification that will fire again on the next execution. If a 429 rate limit is hit, the `retry_after` value could be honored in a future enhancement, but for a single-bot single-chat scenario this is extremely unlikely.

### deliveryStatus Column Migration Strategy
**Recommendation:** Keep the existing `delivery_status` DB column but rename the Drizzle field from `deliveryStatus` to `emailDeliveryStatus`. Add new `telegram_delivery_status` column. This approach:
- Preserves existing data without migration risk
- `db:push` handles adding the new column cleanly
- Drizzle field rename is a code-only change (the column name in SQLite stays `delivery_status`)
- All existing code that references `deliveryStatus` needs updating to `emailDeliveryStatus`

### Exact MarkdownV2 Escaping Implementation
**Recommendation:** Two functions: `escapeMdV2()` for general text (escapes all 18 chars) and `escapeMdV2CodeBlock()` for pre/code content (escapes only `` ` `` and `\`). Keep them in a dedicated `src/services/telegram.ts` utility module alongside `sendTelegramMessage()`.

### Test Strategy for Telegram Notification
**Recommendation:** Mock `fetch` globally in the Telegram-specific test file. The pattern should match how nodemailer and Resend are mocked in the existing notifier.test.ts. Key test cases:
- `sendViaTelegram` returns `{ status: "sent" }` on `{ ok: true }` response
- `sendViaTelegram` returns `{ status: "failed" }` on `{ ok: false, description: "..." }` response
- `sendViaTelegram` returns `{ status: "failed" }` on network error (fetch throws)
- `sendTelegramNotification` skips when env vars missing
- `buildTelegramMarkdown` escapes special characters correctly
- `buildTelegramMarkdown` truncates at 3800 chars
- `buildTelegramFailureMarkdown` includes warning emoji and "FAILED:" header
- `escapeMdV2` escapes all 18 special characters
- `escapeMdV2CodeBlock` only escapes `` ` `` and `\`

## Open Questions

1. **Drizzle field rename impact on existing code**
   - What we know: Renaming `deliveryStatus` -> `emailDeliveryStatus` in Drizzle schema changes the TS field name used everywhere. The DB column name `delivery_status` stays the same.
   - What's unclear: Exact count of places that reference `deliveryStatus` (executor.ts, health.ts, mcp health, tests).
   - Recommendation: Use grep to find all references and update them. This is a mechanical refactor.

2. **Health endpoint per-channel delivery stats query**
   - What we know: Health endpoint currently queries recent executions and counts success/failure. Need to add email and Telegram delivery stats.
   - What's unclear: Whether to count from the 24h window (existing pattern) or all-time.
   - Recommendation: Follow existing pattern -- 24h window, count email sent/failed and telegram sent/failed separately from the same query.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements to Test Map
| Behavior | Test Type | Automated Command | File Exists? |
|----------|-----------|-------------------|-------------|
| sendViaTelegram sends message via Bot API | unit | `pnpm vitest run tests/notifier.test.ts -t "Telegram"` | No -- Wave 0 |
| buildTelegramMarkdown formats output correctly | unit | `pnpm vitest run tests/notifier.test.ts -t "telegram content"` | No -- Wave 0 |
| escapeMdV2 escapes all 18 special chars | unit | `pnpm vitest run tests/telegram.test.ts` | No -- Wave 0 |
| Telegram skipped when env vars missing | unit | `pnpm vitest run tests/notifier.test.ts -t "skips telegram"` | No -- Wave 0 |
| Parallel dispatch via Promise.allSettled | unit | `pnpm vitest run tests/executor.test.ts -t "notification"` | Partially (needs update) |
| Per-channel delivery status in DB | unit | `pnpm vitest run tests/executor.test.ts -t "delivery"` | Partially (needs update) |
| Health endpoint per-channel stats | unit | `pnpm vitest run tests/health.test.ts` | Partially (needs update) |
| test_telegram MCP tool | unit | `pnpm vitest run tests/mcp-telegram.test.ts` | No -- Wave 0 |
| Message truncation at 3800 chars | unit | `pnpm vitest run tests/notifier.test.ts -t "truncat"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/telegram.test.ts` -- unit tests for escapeMdV2, escapeMdV2CodeBlock, sendTelegramMessage
- [ ] Update `tests/notifier.test.ts` -- add Telegram transport tests, multi-channel dispatch tests
- [ ] Update `tests/executor.test.ts` -- update notification integration tests for per-channel status
- [ ] `tests/mcp-telegram.test.ts` -- test_telegram MCP tool tests
- [ ] Update `tests/health.test.ts` -- per-channel delivery stats

## Sources

### Primary (HIGH confidence)
- [Telegram Bot API official docs](https://core.telegram.org/bots/api) -- sendMessage endpoint, MarkdownV2 syntax, link_preview_options, response format
- [Telegram Bot FAQ](https://core.telegram.org/bots/faq) -- rate limits (1 msg/sec per chat, 30 msg/sec global)
- Existing codebase: `src/services/notifier.ts`, `src/services/executor.ts`, `src/db/schema.ts`, `src/config/env.ts` -- established patterns

### Secondary (MEDIUM confidence)
- [Telegram Bot API changelog](https://core.telegram.org/bots/api-changelog) -- Bot API 7.0 deprecation of disable_web_page_preview
- [MarkdownV2 escaping discussion (telegraf issue #1242)](https://github.com/telegraf/telegraf/issues/1242) -- community confirmation of 18-char escape list

### Tertiary (LOW confidence)
- npm telegram-markdown-v2 package assessment -- low adoption, not recommended

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no external dependencies needed, Telegram Bot API is stable and well-documented
- Architecture: HIGH -- follows existing notifier.ts patterns exactly, integration points clearly identified in codebase
- Pitfalls: HIGH -- MarkdownV2 escaping rules well-documented, message limits confirmed from official docs
- Telegram API: HIGH -- extremely stable API, rarely changes, backward compatible

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (Telegram Bot API is very stable, rarely has breaking changes)
