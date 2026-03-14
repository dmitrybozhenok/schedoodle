# Phase 5: Notification - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Email delivery of agent results after successful execution via Resend. Emails are sent automatically after each successful agent run. Delivery failures are tracked independently and never affect execution status. No per-agent templates (v2), no other notification channels, no failure notifications.

</domain>

<decisions>
## Implementation Decisions

### Email content & layout
- Subject line: "[Schedoodle] Agent Name — Summary" (e.g., "[Schedoodle] Morning Briefing — 3 key items found")
- HTML email with clean layout: header (agent name + timestamp), summary section, details section
- If the output has a data field, render it as a formatted JSON code block at the bottom
- Only send emails on successful executions — no failure notifications

### Delivery configuration
- Single recipient via NOTIFICATION_EMAIL env var (personal tool, one user)
- Sender address via NOTIFICATION_FROM env var (Resend requires verified domain)
- RESEND_API_KEY env var for Resend authentication
- Notification is optional — if NOTIFICATION_EMAIL or RESEND_API_KEY is missing, skip email delivery silently. Don't crash on missing email config. Agents work fine without notifications.

### Failure handling & delivery status
- deliveryStatus values: pending / sent / failed (three states)
- Set to 'pending' before sending, update to 'sent' on success or 'failed' on Resend error
- No retry on failure — log the error and continue
- Delivery failures never mark the execution as failed (NOTF requirement)

### Claude's Discretion
- Resend SDK usage patterns
- HTML template styling
- How the notifier is called from the executor (after DB update, fire-and-forget)
- Whether to add env vars as optional to Zod schema or handle separately

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/db/schema.ts`: deliveryStatus column already exists on executionHistory (Phase 1)
- `src/services/executor.ts`: executeAgent() returns ExecuteResult with output — notifier hooks in after success
- `src/schemas/agent-output.ts`: AgentOutput type { summary, details, data? } — email content source
- `src/config/env.ts`: Zod env schema — add RESEND_API_KEY, NOTIFICATION_EMAIL, NOTIFICATION_FROM as optional

### Established Patterns
- Zod v4 for config validation
- Plain functions for services (not classes)
- Factory functions with DI for routes (createAgentRoutes, createHealthRoute)
- ESM with .js extensions
- Vitest with mocked dependencies

### Integration Points
- `src/services/notifier.ts` (new) — called by executor after successful execution
- `src/config/env.ts` — add optional email config vars
- `src/services/executor.ts` — call notifier after success DB update, update deliveryStatus
- executionHistory.deliveryStatus — already exists, just needs to be populated

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-notification*
*Context gathered: 2026-03-14*
