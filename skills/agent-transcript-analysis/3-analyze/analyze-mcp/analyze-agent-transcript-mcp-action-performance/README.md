# `analyze-agent-transcript-mcp-action-performance`

Per-segment analyzer for **MCP tool calls that actually happened** — response shape, token cost, error quality, side effects.

## How it plugs in

Invoked once per segment by `analyze-agent-transcript`. Companion to `analyze-agent-transcript-mcp-trigger-performance` (the description) and `analyze-agent-transcript-mcp-gaps` (the missing).

For each MCP call, emits an outcome (helpful / neutral / hurtful), response-shape findings, a cost estimate, and an optional modify / remove recommendation.

## Design decisions

- **Verbose responses are first-class failures.** A tool that returns >~3k tokens the agent didn't need is flagged — that's the kind of cost that drives compaction thrashing.
- **Errors are a feature.** A good MCP tool's error tells the agent how to recover; a bad one dumps a stack trace. Error quality gets its own field in the output.
- **Three distinct fixes.** `modify_response` changes the output shape only; `modify_implementation` changes behavior; `remove_tool` retires. Conflating these blurs the recommendation.
- **Don't manufacture work.** A tool that performed cleanly produces `kind: "none"`.
