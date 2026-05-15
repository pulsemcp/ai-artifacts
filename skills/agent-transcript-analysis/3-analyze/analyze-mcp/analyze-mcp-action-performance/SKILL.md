---
name: analyze-mcp-action-performance
description: >
  For each MCP tool call in a Transcript Segment, assess whether the call
  helped or hurt the Segment's Goal, whether its response shape was usable,
  and whether its token cost was proportionate. Output recommendations to
  modify tool implementations or response shapes — or to delete tools that
  are net-negative.
user-invocable: false
---

# Analyze MCP action performance

Per-Segment analyzer. Focuses on **the behavior of MCP tools that ran** — their response shape, token cost, error messages, and side effects.

## Inputs

- `segment`: a Segment from `segments.json` (Goal, Outcome, `meta.event_range`). The orchestrator hands you the Segment directly — you do not walk raw JSONL.
- `transcript.json`: the OpenTranscripts `Transcript` document. Dereference event ids from `segment.meta.event_range` into `transcript.json` `events[]` to find MCP `ToolCall` events, their paired `ToolResult` events, and the events those responses caused.
- `external_context` (optional): `external-context.json` if present.
- `philosophy_mcp`: the `philosophy-on-mcp` reference

## Output

This is the item **body**. The orchestrator wraps it with `id` / `segment_id` / `analyzer` (see the orchestrator's "Findings-item shape" section) — emit only the fields below.

```json
{
  "calls": [
    {
      "tool": "...",
      "called_at_event": "<event id>",
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

`called_at_event` and any evidence cite **OpenTranscripts event ids** (the `id` strings in `transcript.json`), never integer turn numbers. **When this Segment made no MCP tool call**, return nothing; the orchestrator omits the item rather than writing one with an empty `calls` array.

## Sequencing checklist

- [ ] For each MCP `ToolCall` in the Segment's event range, look at the call args and its paired `ToolResult`. Was the response useful? Was it too big? Was it too small? Did it give the agent what it needed to take the next step?
- [ ] Pay particular attention to **errors**: a good MCP tool's error message tells the agent how to recover. A bad one just dumps a stack trace and forces the agent to guess
- [ ] **Verbose responses** are a high-frequency failure mode — they cause compaction thrashing. Flag any tool response > ~3k tokens that the agent didn't need in full
- [ ] Recommendations:
  - **modify_response** — change what the tool returns (shape, brevity, error messages) without changing the underlying capability
  - **modify_implementation** — the tool's *behavior* is wrong, not just its shape (e.g. needs caching, needs better filtering args)
  - **remove_tool** — the tool is net-negative and should be retired (per the philosophy doc)
- [ ] Cross-check against the `philosophy-on-mcp` reference

## Notes

- A tool call that was perfect in this Segment should produce `kind: "none"`.
- Token cost is a first-class concern. A "correct but verbose" tool can be more expensive than a missing tool — flag it accordingly.
- **A `modify_response` / `modify_implementation` here is the *owner* of any defect in an existing MCP tool that fired.** When an MCP tool was called and the fix is to its body, response shape, or implementation, this analyzer's recommendation is the canonical finding — `analyze-mcp-gaps` must **not** also propose a new server/tool for the same defect (it defers). If a failure-hypothesis seed routed `analyze-mcp-gaps` at the same defect, expect the gap analyzer to record the deferral and let `synthesize-report` reconcile to this recommendation.
