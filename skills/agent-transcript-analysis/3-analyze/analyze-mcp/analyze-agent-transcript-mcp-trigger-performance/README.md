# `analyze-agent-transcript-mcp-trigger-performance`

Per-segment analyzer for **whether the agent reached for the right MCP tool at the right time** — and whether the tool's `description` made that easy.

## How it plugs in

Invoked once per segment by `analyze-agent-transcript`. MCP-side counterpart to `analyze-agent-transcript-skill-trigger-performance`. Companion to `analyze-agent-transcript-mcp-action-performance` (the behavior) and `analyze-agent-transcript-mcp-gaps` (the missing).

Output is false positives (tools called when they shouldn't have been) and false negatives (tools the agent should have used but didn't — usually because it reached for a CLI or hand-rolled HTTP instead).

## Design decisions

- **Description is the usual lever.** Most false negatives are fixed by aligning a tool's `description` with the words the user / agent actually uses, not by adding new tools.
- **Tool surface as a backstop.** When description tweaks aren't enough, the tool itself may be too granular or too coarse. That's a `modify_tool` recommendation, separate from a `modify_description` one.
- **Skill-wrapped misses go elsewhere.** If a Skill was supposed to invoke the tool and didn't, that's a Skill-body finding (`analyze-agent-transcript-skill-action-performance`), not an MCP trigger finding.
