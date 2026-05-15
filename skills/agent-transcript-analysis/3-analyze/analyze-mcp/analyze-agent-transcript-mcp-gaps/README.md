# `analyze-agent-transcript-mcp-gaps`

Per-segment analyzer for **MCP servers / tools that should exist but don't**. The "what's missing" half of the MCP bucket.

## How it plugs in

Invoked once per segment by `analyze-agent-transcript`. Companion to `analyze-agent-transcript-mcp-trigger-performance` and `analyze-agent-transcript-mcp-action-performance`, which both work on tools that *do* exist.

Output is a list of proposals: new server, or new tool on an existing server, with an interface sketch and auth model.

## Design decisions

- **CLI-workaround is the loudest signal.** Whenever the agent shells out to a CLI that needs credentials it doesn't have — or asks the user to paste in data it could have fetched — that's a candidate gap.
- **Reuse beats new.** Default to adding a tool to an existing server. Propose a new server only when none fits.
- **Skill or MCP?** Every proposal evaluates whether a Skill wrapping an existing CLI would do the job. MCP wins when credentials, response shape, or persistent connection make the CLI brittle. The philosophy doc draws the line.
- **Expect a paired Skill proposal.** Closing a closed-loop gap typically needs both an MCP server (for the capability) and a Skill (for the orchestration). `analyze-agent-transcript-skill-gaps` usually proposes the companion.
