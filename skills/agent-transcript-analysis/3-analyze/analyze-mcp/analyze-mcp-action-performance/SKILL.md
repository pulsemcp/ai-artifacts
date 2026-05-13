---
name: analyze-mcp-action-performance
description: >
  For each MCP tool call in a transcript segment, assess whether the call
  helped or hurt the goal, whether its response shape was usable, and
  whether its token cost was proportionate. Output recommendations to
  modify tool implementations or response shapes — or to delete tools that
  are net-negative.
user-invocable: false
---

# Analyze MCP action performance

Per-segment analyzer. Focuses on **the behavior of MCP tools that ran** — their response shape, token cost, error messages, and side effects.

## Inputs

- `segment_messages`: the full segment
- `philosophy_mcp`: `references/philosophy-on-mcp.md`

## Output

```json
{
  "calls": [
    {
      "tool": "...",
      "turn": N,
      "outcome": "helpful" | "neutral" | "hurtful",
      "response_shape_issue": "<too-verbose | too-terse | wrong-fields | unparseable | none>",
      "tokens_estimate": N,
      "turns_caused": N,
      "error_quality": "<good | bad | none>",
      "recommendation": {"kind": "none" | "modify_response" | "modify_implementation" | "remove_tool", "details": "..."}
    }
  ]
}
```

## Sequencing checklist

- [ ] For each MCP tool call, look at the call args and the response. Was the response useful? Was it too big? Was it too small? Did it give the agent what it needed to take the next step?
- [ ] Pay particular attention to **errors**: a good MCP tool's error message tells the agent how to recover. A bad one just dumps a stack trace and forces the agent to guess
- [ ] **Verbose responses** are a high-frequency failure mode — they cause compaction thrashing. Flag any tool response > ~3k tokens that the agent didn't need in full
- [ ] Recommendations:
  - **modify_response** — change what the tool returns (shape, brevity, error messages) without changing the underlying capability
  - **modify_implementation** — the tool's *behavior* is wrong, not just its shape (e.g. needs caching, needs better filtering args)
  - **remove_tool** — the tool is net-negative and should be retired (per the philosophy doc)
- [ ] Cross-check against `philosophy-on-mcp.md`

## Notes

- A tool call that was perfect in this segment should produce `kind: "none"`.
- Token cost is a first-class concern. A "correct but verbose" tool can be more expensive than a missing tool — flag it accordingly.
