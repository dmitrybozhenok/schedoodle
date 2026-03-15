# Phase 7: Natural Language Schedule Parsing - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning
**Source:** User description

<domain>
## Phase Boundary

Add natural language schedule parsing so users can describe when they want an agent to run in plain English instead of writing cron expressions. The system translates natural language into cron expressions, confirms interpretation with the user, and handles ambiguous input gracefully.

</domain>

<decisions>
## Implementation Decisions

### Natural Language Input
- Expressions like "every weekday at 9am", "every Monday at 8am", "twice a day", "every 3 hours", "the first of every month" should be parsed into corresponding cron expressions
- Can use LLM-based translation OR a dedicated natural language parsing library — either approach works

### Confirmation Flow
- When a user provides a natural language schedule, show them the interpreted cron expression AND a human-readable description of what it means (e.g. "Runs at 09:00 on Monday through Friday")
- User must confirm before saving

### Ambiguity Handling
- If the input is ambiguous or can't be parsed, the system should say so clearly and ask the user to rephrase
- Must not guess incorrectly — prefer clarity over silent assumptions

### Claude's Discretion
- API endpoint design (new endpoint vs extending existing POST/PATCH)
- Whether to use LLM or library for parsing (both acceptable)
- Response format for the confirmation step
- How to detect if input is natural language vs already a cron expression

</decisions>

<specifics>
## Specific Ideas

- Example NL inputs: "every weekday at 9am", "every Monday at 8am", "twice a day", "every 3 hours", "the first of every month"
- Confirmation response should include both the cron expression and human-readable description
- Error messages should guide user to rephrase rather than failing silently

</specifics>

<deferred>
## Deferred Ideas

None — user description covers phase scope.

</deferred>

---

*Phase: 07-natural-language-schedule-parsing*
*Context gathered: 2026-03-15 via user description*
