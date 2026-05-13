# `analyze-mcp` bucket

The MCP recommendation bucket — three analyzers covering existing MCP tools and missing ones:

- `analyze-mcp-trigger-performance/` — tools called when they shouldn't have been, or available tools the agent didn't reach for
- `analyze-mcp-action-performance/` — tools that ran: response shape, token cost, error quality
- `analyze-mcp-gaps/` — MCP servers / tools that *should exist but don't*

Mirrors the structure of `../analyze-skills/`, but for MCP instead of Skills.

## How the skills interplay

`analyze-agent-transcript` runs all three per Segment. Same trigger / action / gaps split as the Skills bucket; the same boundary rules apply (a wrong response from the right tool is an *action* problem, not a trigger problem). The gaps analyzer additionally accepts seeds from `analyze-failure-hypothesis` and `analyze-prompt-ambition` (deterministic-trigger candidates) when they point at MCP.

Note: Skills frequently wrap MCP tools. A Skill that was supposed to call an MCP tool but didn't is a Skill-body issue (handled in `../analyze-skills/`), not an MCP trigger issue.

## Design decisions

- **Symmetric with Skills, intentionally.** Trigger / action / gaps gives the same precision benefit for MCP as it does for Skills. We accept the parallel folder structure.
- **Verbose responses are a flagged failure mode.** A correct-but-verbose tool can cost more than no tool at all (compaction thrashing). Action-performance flags tool responses >~3k tokens that the agent didn't need in full.
- **MCP vs Skill is a real choice.** Gaps analyzers must consider whether a CLI-wrapping Skill would do the job before proposing a new MCP server. `references/philosophy-on-mcp.md` is the tiebreaker.
- **Server reuse beats proliferation.** New tools land on existing servers when possible.
