---
phase: 14
slug: mcp-server-for-claude-code-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest v4.1.0 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm vitest run tests/mcp` |
| **Full suite command** | `pnpm vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run tests/mcp`
- **After every plan wave:** Run `pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | MCP-01 | smoke | `pnpm vitest run tests/mcp-server.test.ts -t "starts"` | ❌ W0 | ⬜ pending |
| 14-01-02 | 01 | 1 | MCP-02 | unit | `pnpm vitest run tests/mcp-agents.test.ts -t "list"` | ❌ W0 | ⬜ pending |
| 14-01-03 | 01 | 1 | MCP-03 | unit | `pnpm vitest run tests/mcp-agents.test.ts -t "create"` | ❌ W0 | ⬜ pending |
| 14-01-04 | 01 | 1 | MCP-04 | unit | `pnpm vitest run tests/mcp-agents.test.ts -t "delete"` | ❌ W0 | ⬜ pending |
| 14-01-05 | 01 | 1 | MCP-05 | unit | `pnpm vitest run tests/mcp-agents.test.ts -t "error"` | ❌ W0 | ⬜ pending |
| 14-02-01 | 02 | 1 | MCP-06 | unit | `pnpm vitest run tests/mcp-tools.test.ts` | ❌ W0 | ⬜ pending |
| 14-03-01 | 03 | 1 | MCP-07 | unit | `pnpm vitest run tests/mcp-health.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/mcp-agents.test.ts` — agent CRUD tool handler tests
- [ ] `tests/mcp-tools.test.ts` — tool CRUD tool handler tests
- [ ] `tests/mcp-health.test.ts` — health tool handler tests
- [ ] SDK install: `pnpm add @modelcontextprotocol/sdk` — new dependency

*Test approach: Unit-test handler logic by calling tool handler functions directly with mocked in-memory DB (same pattern as routes-agents.test.ts). Do NOT test MCP protocol-level behavior — the SDK handles that.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MCP server connects via Claude Code | MCP-01 | Requires actual Claude Code MCP client | Add to `.mcp.json`, verify tools appear in Claude Code |
| execute_agent returns LLM result | MCP-03 | Requires real LLM API call | Create test agent, execute via Claude Code, verify output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
