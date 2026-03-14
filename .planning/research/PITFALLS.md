# Domain Pitfalls

**Domain:** Scheduled AI agent system (cron-triggered LLM tasks with email delivery)
**Project:** Schedoodle
**Researched:** 2026-03-14
**Confidence:** MEDIUM (training data only -- web search unavailable for verification)

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or silent failures that undermine the core value proposition (agents run reliably without manual intervention).

---

### Pitfall 1: Silent Schedule Failures

**What goes wrong:** Agents stop running and nobody notices. The scheduler crashes, a cron expression is invalid, or the process restarts and jobs are never re-registered. Because the system is headless (no dashboard), there is no visual indicator that nothing is happening. The user only realizes days later when they stop receiving emails.

**Why it happens:** In-process schedulers like node-cron live in memory. Process crash = all schedules gone. Unlike external schedulers (systemd timers, cloud schedulers), there is no independent watchdog. Combined with "catch-up on startup" logic, if the startup logic has a bug, it silently skips everything.

**Consequences:** Core value destroyed -- the system exists to run reliably without intervention, and it silently stops doing that.

**Prevention:**
- Implement a "heartbeat" mechanism: record the last successful execution timestamp per agent in the database. On startup, compare `lastRun + interval` against `now` to detect missed runs.
- Add a dedicated "watchdog agent" that runs every hour and checks whether other agents have executed on schedule. If any are overdue, it sends an alert email.
- Log every schedule registration and every cron tick (even if no agents fire) so the absence of logs is detectable.
- Write integration tests that fast-forward time (using Vitest's `vi.useFakeTimers`) to verify the scheduler actually fires callbacks.

**Detection (warning signs):**
- No execution history rows being written for an agent that should be running
- Missing log entries during expected execution windows
- `lastRunAt` timestamps falling behind expected schedule

**Phase:** Step 0/1 -- build the execution logging from the start; add watchdog in the scheduling phase (Step 2).

---

### Pitfall 2: LLM Cost Explosion from Retry Storms

**What goes wrong:** An LLM provider returns transient errors (rate limit, 503, timeout). The retry logic fires. But with multiple agents scheduled close together (e.g., several at 7:00 AM), retries compound: 5 agents x 3 retries = 15 calls in rapid succession, hitting rate limits harder, causing more retries. If retry is exponential but without jitter, all retries align at the same backoff intervals (thundering herd). Worse: if the LLM returns a 200 but with garbage/truncated output, the system may not retry at all but deliver useless results.

**Why it happens:** Retry logic is tested with a single agent in isolation, never under concurrent load. Rate limits from providers (especially Anthropic's per-minute token limits) are shared across all agents but treated independently per-agent in the retry logic.

**Consequences:** Unexpected API bills. Agents deliver garbage. Provider temporarily bans the API key.

**Prevention:**
- Use a shared semaphore/queue for LLM calls so concurrent agents don't blast the API simultaneously. A simple approach: use `p-queue` with concurrency=1 or 2 for LLM calls.
- Add jitter to exponential backoff (the project already notes this -- good).
- Validate LLM output structure before considering the call "successful." If using Vercel AI SDK's `generateObject` with Zod schemas, this is automatic -- but for `generateText`, you must validate the response is non-empty and coherent.
- Implement per-provider rate limit tracking: parse `x-ratelimit-remaining` headers and proactively delay when approaching limits.
- Set a hard cost ceiling: track token usage per day, refuse to execute agents once the ceiling is hit (send an alert email instead).

**Detection:**
- Rapid growth in execution_history rows with `status: 'failed'`
- Multiple agents failing in the same time window
- API billing alerts

**Phase:** Step 2 (retry logic). The circuit breaker requirement already addresses provider-level protection, but the concurrency queue and cost ceiling are separate concerns to add alongside it.

---

### Pitfall 3: Catch-Up Logic Executing Stale or Dangerous Bulk Runs

**What goes wrong:** The service was down for 12 hours. On restart, catch-up logic detects 8 missed runs across 5 agents and fires them all immediately. This causes: (a) a burst of 8 LLM calls saturating rate limits, (b) agents producing stale/irrelevant results (a "morning briefing" generated at 9 PM is useless), (c) the user's inbox flooded with 8 emails at once, some with outdated information.

**Why it happens:** Catch-up logic is implemented as "if missed, run now" without considering whether the missed execution is still relevant or whether bulk catch-up should be throttled.

**Consequences:** Wasted API spend on stale tasks, inbox flood, user loses trust in the system.

**Prevention:**
- Add a `catchUpPolicy` per agent: `"always"` (run all missed), `"latest"` (run once with latest data, skip intermediate), `"skip"` (never catch up, just wait for next scheduled run). Default to `"latest"` -- most use cases only care about the current state.
- For "morning briefing" type agents, `"skip"` is correct -- a briefing 14 hours late is noise.
- For "dependency watch" type agents, `"latest"` is correct -- you want the check, but only one.
- Throttle catch-up executions through the same concurrency queue as regular runs.
- Cap catch-up window: if missed by more than 24 hours, skip regardless of policy (configurable).

**Detection:**
- Multiple execution_history entries with similar timestamps for the same agent after a restart
- User complaints about stale/irrelevant email content

**Phase:** Step 2 (scheduling). This must be designed into the scheduler from the beginning, not bolted on later.

---

### Pitfall 4: Unbounded LLM Context from Data Pre-Fetch

**What goes wrong:** An agent is configured to "check all open PRs" or "scan HN front page." The pre-fetch step dutifully grabs all the data, but the combined payload exceeds the LLM's context window or (more commonly) produces a response so expensive it blows the budget. A dependency watch agent checking 200 dependencies will generate massive input. Over time, as the data sources grow, what worked in testing breaks in production.

**Why it happens:** The pre-fetch architecture (which is correct for reliability) decouples data gathering from LLM submission, making it easy to forget about context limits. Developers test with small datasets that fit comfortably.

**Consequences:** LLM calls fail with context length errors. Or succeed but cost 10x expected. Or the LLM truncates its analysis, missing important items.

**Prevention:**
- Enforce a `maxInputTokens` limit per agent (default: 8,000 tokens). Truncate or summarize pre-fetched data before sending to LLM.
- Implement a data budget: estimate token count of pre-fetched content before the LLM call. If over budget, either chunk into multiple calls or truncate with a warning in the output.
- Use a cheap/fast pre-processing step: filter and rank fetched data before sending the most relevant subset to the LLM.
- Log input token count per execution so you can spot gradual growth.

**Detection:**
- Rising token costs per agent execution over time
- LLM API errors citing context length limits
- Agent results becoming less detailed despite same prompts (LLM rushing through too much input)

**Phase:** Step 1 (agent execution). Build token estimation into the execution pipeline from the start.

---

### Pitfall 5: Email Delivery Treated as Fire-and-Forget

**What goes wrong:** The agent runs successfully, the LLM produces a great result, but the email never arrives. Resend API returns a 429 (rate limit) or 500 and the code doesn't check the response. Or the email is sent but lands in spam because the domain isn't properly configured (no SPF/DKIM). The user never sees results and has no way to know the agent actually ran.

**Why it happens:** Email delivery is treated as the "easy last step" and gets minimal error handling. Developers test with their own inbox (which has the sending domain whitelisted) and never encounter deliverability issues.

**Consequences:** Agents appear broken even though they ran fine. User loses confidence. Results are generated but never delivered -- wasted LLM spend.

**Prevention:**
- Treat email delivery as part of the execution pipeline, not a side effect. Record `deliveryStatus` alongside `executionStatus` in the execution history. An agent run is only `"completed"` when both LLM and email succeed.
- Retry email delivery independently of LLM retry (don't re-run the whole agent just because email failed).
- Store the full result in the database regardless of email delivery -- the API can serve as a fallback for retrieving results.
- Validate Resend domain setup (SPF, DKIM, domain verification) as part of the setup/health-check phase.
- Monitor Resend's webhook callbacks for bounce/complaint events if scaling beyond personal use.

**Detection:**
- Execution history shows `status: 'success'` but user reports no email
- Resend dashboard shows bounces or failures
- `deliveryStatus` field (once implemented) showing failures

**Phase:** Step 2+ (email delivery). Design the execution record schema to include delivery status from the beginning (Step 0 schema design).

---

## Moderate Pitfalls

---

### Pitfall 6: Cron Expression Validation Gap

**What goes wrong:** User creates an agent with cron expression `* * * * *` (every minute) or `0 */1 * * * *` (every second in some implementations). The system happily schedules it, burning through LLM API quota in minutes. Or a malformed expression like `0 25 * * *` silently fails or behaves unexpectedly.

**Prevention:**
- Validate cron expressions at agent creation time using a parsing library (e.g., `cron-parser`). Reject expressions that would fire more frequently than a configurable minimum interval (e.g., 5 minutes).
- Show the user the "next 5 execution times" as part of the creation response so they can verify correctness.
- Reject non-standard 6-field (with seconds) cron expressions unless explicitly enabled.

**Detection:**
- Agent executing far more frequently than expected (check execution count per hour)
- Rapid API usage spikes

**Phase:** Step 2 (scheduling). Validate at the API layer before persisting.

---

### Pitfall 7: Prompt Drift and Non-Deterministic Outputs

**What goes wrong:** An agent works perfectly for weeks, then starts producing different-format results because the LLM provider updated their model. Or the same agent produces wildly different output quality on different runs because the prompt doesn't sufficiently constrain the output. Email formatting breaks because the LLM stopped using the expected markdown structure.

**Prevention:**
- Use `generateObject` with Zod schemas (via Vercel AI SDK) for all agent outputs. This forces structured JSON responses, eliminating format drift.
- Pin model versions in agent configuration (e.g., `claude-sonnet-4-20250514` not `claude-sonnet-4`). Accept that you'll need to manually update model versions.
- Include example output in system prompts to anchor the LLM's formatting.
- Store the model version used in each execution record for debugging.

**Detection:**
- Email formatting suddenly changes
- Zod validation failures on previously-working agents
- User reports of inconsistent result quality

**Phase:** Step 1 (agent execution). Use structured output from the start.

---

### Pitfall 8: SQLite Write Contention Under Concurrent Agents

**What goes wrong:** Multiple agents fire at the same time (e.g., three agents scheduled for 8:00 AM). Each writes execution results to SQLite simultaneously. SQLite handles concurrent reads well but serializes writes. With WAL mode off (the default for better-sqlite3), concurrent writes cause `SQLITE_BUSY` errors. Even with WAL mode, high write contention can cause slowdowns.

**Prevention:**
- Enable WAL (Write-Ahead Logging) mode on database initialization: `PRAGMA journal_mode=WAL`.
- Set a busy timeout: `PRAGMA busy_timeout=5000` so writes retry automatically instead of throwing immediately.
- Serialize writes through a single write queue (the same concurrency queue used for LLM calls works here).
- Keep write transactions short -- don't hold a transaction open during an LLM call.

**Detection:**
- `SQLITE_BUSY` errors in logs
- Execution results occasionally missing from the database
- Slow query performance during peak scheduling windows

**Phase:** Step 0 (database setup). Set pragmas at connection initialization.

---

### Pitfall 9: No Observability into Agent Health

**What goes wrong:** The system runs for weeks. Some agents silently start failing (a URL they fetch changed, an API key expired, the LLM consistently returns low-quality results). The user has no dashboard (by design) and no alerting beyond the results themselves. They don't notice an agent stopped working until they specifically need that information.

**Prevention:**
- Implement a `/health` API endpoint that reports: number of registered agents, last execution time per agent, success/failure rates over last 24h, next scheduled run per agent.
- Add a meta-agent: a special agent that runs daily and checks the health of all other agents (last success time, failure rate). If any agent's failure rate exceeds a threshold, the meta-agent's email report highlights it.
- Expose execution statistics through the management API: success rate, average execution time, average token usage per agent.

**Detection:**
- This pitfall IS the lack of detection. If you don't build observability, you can't detect problems.

**Phase:** Step 2+ (management API). Build the health endpoint alongside the CRUD API.

---

### Pitfall 10: Testing with Real LLM Calls

**What goes wrong:** Tests are slow (2-5 seconds per LLM call), expensive (real API charges), and flaky (non-deterministic responses cause assertion failures). Developers skip tests or write them poorly. CI pipelines become unreliable.

**Prevention:**
- Create a `MockLLMProvider` that implements the same interface as the real provider but returns canned responses. Use it for all unit and integration tests.
- Test the LLM integration layer separately with a small number of real API calls (marked as `@slow` or in a separate test suite).
- Use Vitest's mocking to intercept the Vercel AI SDK calls at the boundary.
- Record real LLM responses and replay them in tests (snapshot testing for LLM outputs).

**Detection:**
- Test suite taking more than 30 seconds
- Tests failing intermittently with different LLM responses
- API charges from test runs

**Phase:** Step 1 (agent execution). Establish the mock boundary before writing any agent tests.

---

## Minor Pitfalls

---

### Pitfall 11: Timezone Confusion in Cron Expressions

**What goes wrong:** User defines a cron schedule meaning "7 AM Eastern" but node-cron interprets it as UTC. The agent fires at 2 AM or 3 AM local time. Daylight saving time changes shift the schedule by an hour twice a year.

**Prevention:**
- Explicitly set the timezone in the cron job configuration. `node-cron` supports a `timezone` option. Store it per agent.
- Default to a sensible timezone (the server's local timezone or a user-configured global timezone).
- Document clearly that cron expressions are interpreted in the configured timezone.

**Phase:** Step 2 (scheduling). Include timezone in the agent schema.

---

### Pitfall 12: Secrets in Agent Definitions

**What goes wrong:** Agent task descriptions or data-fetch configurations contain API keys, passwords, or tokens (e.g., "fetch my GitHub PRs using token ghp_xxx..."). These get stored in plaintext in SQLite and returned through the API.

**Prevention:**
- Store data-fetch credentials as environment variable references, not inline values. Agent config says `$GITHUB_TOKEN`, runtime resolves it.
- Never return raw credentials through the API.
- Add a secrets/credentials subsystem if agents need per-agent credentials.

**Phase:** Step 1 (agent definition schema). Design the schema to separate credentials from task descriptions.

---

### Pitfall 13: Process Memory Leaks from Long-Running Scheduler

**What goes wrong:** The Node.js process runs continuously for days or weeks. Each agent execution allocates memory for HTTP responses, LLM payloads, and email content. If these aren't properly garbage collected (common with large string buffers and closures holding references), memory usage grows until the process crashes or becomes unresponsive.

**Prevention:**
- Profile memory usage during development with `--inspect` and Chrome DevTools.
- Set `--max-old-space-size` to a reasonable limit so the process crashes cleanly rather than thrashing.
- Use streaming for large HTTP responses during pre-fetch (don't buffer entire response bodies in memory).
- Avoid storing execution results in memory -- write to database immediately and let the garbage collector reclaim the buffers.

**Phase:** Step 2+ (when the process runs long-term). Add memory monitoring to the health endpoint.

---

## Phase-Specific Warnings

| Phase / Step | Likely Pitfall | Mitigation |
|--------------|---------------|------------|
| Step 0: Schema design | Not including `deliveryStatus`, `tokenUsage`, `modelVersion` in execution history schema | Design the schema with all observability fields from day one, even if you don't populate them yet |
| Step 0: Database setup | SQLite not configured for concurrent access | Set WAL mode and busy_timeout in database initialization code |
| Step 1: Agent execution | Testing with real LLM calls; no input size limits | Build mock provider interface first; add token estimation |
| Step 1: Agent definition | Secrets stored inline in task descriptions | Use environment variable references for credentials |
| Step 2: Scheduling | Catch-up logic floods system after downtime; no timezone support | Implement catch-up policies per agent; include timezone in config |
| Step 2: Retry/circuit breaker | Retry storms from concurrent agents; no cost ceiling | Use shared concurrency queue; track daily token spend |
| Step 2+: Email delivery | Fire-and-forget delivery; no retry on email failure | Track delivery status; retry email independently from LLM execution |
| Step 2+: Management API | No health/observability endpoint | Build `/health` alongside CRUD; consider meta-agent for alerting |
| Ongoing operations | Memory leaks; prompt drift from model updates | Pin model versions; monitor memory; periodic health checks |

## Sources

- Training data on LLM API integration patterns, Node.js scheduling, SQLite concurrency, and email delivery systems (MEDIUM confidence -- not verified against current documentation due to web search unavailability)
- Vercel AI SDK structured output patterns (MEDIUM confidence from training data)
- node-cron behavior and SQLite WAL mode (HIGH confidence -- well-established, stable patterns)
