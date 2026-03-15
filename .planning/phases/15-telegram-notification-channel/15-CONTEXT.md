# Phase 15: Telegram Notification Channel - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Add Telegram as a second notification channel alongside existing email (Resend/SMTP). Telegram notifications fire independently from email after each agent execution. Both channels can be active simultaneously. Configuration is via env vars, matching the existing email pattern.

</domain>

<decisions>
## Implementation Decisions

### Channel selection logic
- Both channels fire independently -- if Telegram is configured, send to Telegram; if email is configured, send email
- Telegram configured via two env vars: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (same pattern as email's RESEND_API_KEY + NOTIFICATION_EMAIL)
- Skip Telegram silently if either env var is missing (matches Phase 5 email pattern)
- Both channels dispatch in parallel via Promise.allSettled -- neither blocks the other

### Delivery status tracking
- Per-channel delivery status columns: separate tracking for email and Telegram
- Add telegramDeliveryStatus column to executionHistory
- Existing deliveryStatus column migration approach is Claude's discretion (rename vs keep + add)

### Message formatting
- Telegram MarkdownV2 format for structured output
- Message structure: bold agent name, timestamp, summary section, details section
- Data field rendered as code block if present
- Truncate at ~3800 chars (room for header), append "... [truncated, see email for full output]"
- Failure messages use warning emoji prefix and "FAILED:" in header

### Telegram API & behavior
- Disable link previews (disable_web_page_preview=true) -- agent outputs often contain URLs
- Normal notification sound (no disable_notification)
- Add sendViaTelegram() alongside existing sendViaSmtp()/sendViaResend() in notifier.ts -- no channel abstraction refactor

### Notification scope
- Both success and failure executions trigger Telegram messages (matches email behavior)
- Failure messages have distinct visual format (warning emoji + "FAILED:" header)

### MCP integration
- Add test_telegram MCP tool for setup verification -- sends a test message to confirm config is working

### Health endpoint
- Health endpoint shows per-channel delivery stats (email and Telegram success/failure counts)

### Claude's Discretion
- Telegram Bot API client approach (direct HTTP fetch vs library)
- Retry behavior on Telegram delivery failure
- deliveryStatus column migration strategy (rename existing vs keep + add new)
- Exact MarkdownV2 escaping implementation
- Test strategy for Telegram notification (mocking approach)

</decisions>

<specifics>
## Specific Ideas

- Telegram messages should feel like a quick-glance notification -- agent name and summary scannable at a glance on mobile
- The test_telegram MCP tool should be a simple "send hello world" to verify the bot token and chat ID are working

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/notifier.ts`: sendNotification() and sendFailureNotification() -- add Telegram alongside existing email functions
- `src/services/notifier.ts`: buildEmailHtml() pattern -- create analogous buildTelegramMarkdown()
- `src/services/notifier.ts`: sendViaSmtp()/sendViaResend() pattern -- add sendViaTelegram() in same style
- `src/config/env.ts`: Zod env schema -- add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID as optional strings
- `src/db/schema.ts`: executionHistory table with deliveryStatus column -- add telegramDeliveryStatus
- `src/services/executor.ts`: fire-and-forget notification pattern after execution -- extend to dispatch both channels

### Established Patterns
- Zod v4 for config validation (env vars)
- Plain functions for services (not classes)
- Fire-and-forget notification with try/catch isolation from execution status
- deliveryStatus values: pending / sent / failed / null (skipped)
- ESM with .js extensions, Biome for formatting

### Integration Points
- `src/services/notifier.ts` -- add sendViaTelegram(), update sendNotification/sendFailureNotification to orchestrate both channels
- `src/config/env.ts` -- add TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID as optional
- `src/db/schema.ts` -- add telegramDeliveryStatus column
- `src/services/executor.ts` -- update notification dispatch to handle per-channel status updates
- `src/routes/health.ts` -- add per-channel delivery stats
- `src/mcp/tools/health.ts` -- reflect per-channel stats in MCP health tool
- `src/mcp.ts` -- register test_telegram MCP tool

</code_context>

<deferred>
## Deferred Ideas

- Per-agent notification channel configuration (choose email, Telegram, or both per agent) -- future phase
- Notification channel abstraction/interface pattern -- revisit if a third channel is added
- Telegram inline keyboard buttons for agent actions (re-run, disable) -- future enhancement
- Silent mode toggle per agent -- future enhancement

</deferred>

---

*Phase: 15-telegram-notification-channel*
*Context gathered: 2026-03-15*
