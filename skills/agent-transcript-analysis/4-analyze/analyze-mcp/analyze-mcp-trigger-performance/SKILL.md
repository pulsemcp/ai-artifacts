---
name: analyze-mcp-trigger-performance
description: >
  Within a Transcript Segment, identify MCP tools that were called when they
  shouldn't have been (false positives) and MCP tools that should have been
  called but weren't (false negatives — e.g. the agent reached for a CLI or
  hand-rolled an HTTP request when an available MCP tool would have done
  the job). Output recommendations to modify or delete MCP tool surfaces.
user-invocable: false
---

# Analyze MCP trigger performance

Per-Segment analyzer. The MCP-side counterpart to `analyze-skill-trigger-performance`. Focuses on **whether the agent reached for the right MCP tool at the right time** — and whether the tool's `description` made that easy.

## Inputs

- `segment`: a Segment from `segments.json` (Goal, Outcome, turn_range)
- `segment_turns`: the raw turns within `segment.meta.turn_range` from `main.jsonl`
- `available_mcp_tools`: the list of MCP tools available in the session (names + descriptions). The system messages or `.mcp.json` snapshot lists them
- `philosophy_mcp`: `references/philosophy-on-mcp.md`

## Output

```json
{
  "false_positives": [
    {"tool": "...", "called_at_turn": N, "why_wrong": "...", "recommendation": {"kind": "modify_description" | "modify_tool" | "remove_tool", "details": "..."}}
  ],
  "false_negatives": [
    {
      "tool": "...",
      "should_have_been_called_at_turn": N,
      "what_the_agent_did_instead": "<CLI fallback, hand-rolled HTTP, gave up>",
      "why_missed": "<bad description, tool surface unclear, ...>",
      "recommendation": {"kind": "modify_description" | "modify_tool", "details": "..."}
    }
  ]
}
```

## Sequencing checklist

- [ ] Inventory MCP tool calls in `segment_turns`. For each, was it the right call at the right time?
- [ ] Walk `segment_turns` for moments where the agent did something an available MCP tool was designed for, but reached for a CLI or wrote raw HTTP / SDK calls instead
- [ ] For false positives: tighten the tool's description, narrow its surface, or remove it if it's consistently misused
- [ ] For false negatives: typically the **tool description** is the lever — make it match the words the agent (or user) tends to use. Sometimes the **tool surface** is the problem (too granular, too coarse)
- [ ] Cross-check every recommendation against `philosophy-on-mcp.md`

## Notes

- Skills often wrap MCP tools. If a Skill was *supposed* to call an MCP tool but didn't, that's a Skill-body issue (`analyze-skill-action-performance`), not an MCP trigger issue.
- "Called but the response was bad" is an action-performance issue, not a trigger issue.
