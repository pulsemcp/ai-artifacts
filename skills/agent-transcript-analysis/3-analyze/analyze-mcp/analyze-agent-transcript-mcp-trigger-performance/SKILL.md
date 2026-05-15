---
name: analyze-agent-transcript-mcp-trigger-performance
description: >
  Within a Transcript Segment, identify MCP tools that were called when they
  shouldn't have been (false positives) and MCP tools that should have been
  called but weren't (false negatives — e.g. the agent reached for a CLI or
  hand-rolled an HTTP request when an available MCP tool would have done
  the job). Output recommendations to modify or delete MCP tool surfaces.
user-invocable: false
---

# Analyze MCP trigger performance

Per-Segment analyzer. The MCP-side counterpart to `analyze-agent-transcript-skill-trigger-performance`. Focuses on **whether the agent reached for the right MCP tool at the right time** — and whether the tool's `description` made that easy.

## Inputs

- `segment`: a Segment from `segments.json` (Goal, Outcome, `meta.event_range`). The orchestrator hands you the Segment directly — you do not walk raw JSONL.
- `transcript.json`: the OpenTranscripts `Transcript` document. Dereference event ids from `segment.meta.event_range` into `transcript.json` `events[]` to find MCP `ToolCall` events (`tool_name` starting `mcp__`) and the moments where one *should* have fired.
- `available_mcp_tools`: the list of MCP tools available in the session, with names + descriptions. Best-effort recoverable from `transcript.json` — MCP tool surfaces appear in `SystemEvent` attachments and in the `ToolCall` events themselves; may be incompletely recoverable.
- `external_context` (optional): `external-context.json` if present.
- `philosophy_mcp`: the `philosophy-on-mcp` reference

## Output

This is the item **body**. The orchestrator wraps it with `id` / `segment_id` / `analyzer` (see the orchestrator's "Findings-item shape" section) — emit only the fields below.

```json
{
  "false_positives": [
    {"tool": "...", "called_at_event": "<event id>", "why_wrong": "...", "recommendation": {"kind": "modify_description" | "modify_tool" | "remove_tool", "details": "..."}}
  ],
  "false_negatives": [
    {
      "tool": "...",
      "should_have_been_called_at_event": "<event id>",
      "what_the_agent_did_instead": "<CLI fallback, hand-rolled HTTP, gave up>",
      "why_missed": "<bad description, tool surface unclear, ...>",
      "recommendation": {"kind": "modify_description" | "modify_tool", "details": "..."}
    }
  ]
}
```

Evidence cites **OpenTranscripts event ids** (the `id` strings in `transcript.json`), never integer turn numbers. **When this Segment has no signal** — no false positives and no false negatives — return nothing; the orchestrator omits the item rather than writing one with empty arrays.

## Sequencing checklist

- [ ] Inventory MCP `ToolCall` events in the Segment's event range (`tool_name` starting `mcp__`). For each, was it the right call at the right time?
- [ ] Walk the Segment's events for moments where the agent did something an available MCP tool was designed for, but reached for a CLI or wrote raw HTTP / SDK calls instead
- [ ] For false positives: tighten the tool's description, narrow its surface, or remove it if it's consistently misused
- [ ] For false negatives: typically the **tool description** is the lever — make it match the words the agent (or user) tends to use. Sometimes the **tool surface** is the problem (too granular, too coarse)
- [ ] Cross-check every recommendation against the `philosophy-on-mcp` reference

## Notes

- Skills often wrap MCP tools. If a Skill was *supposed* to call an MCP tool but didn't, that's a Skill-body issue (`analyze-agent-transcript-skill-action-performance`), not an MCP trigger issue.
- "Called but the response was bad" is an action-performance issue, not a trigger issue.
