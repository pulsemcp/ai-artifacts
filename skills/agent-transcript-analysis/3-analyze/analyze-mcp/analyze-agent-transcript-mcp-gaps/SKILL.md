---
name: analyze-agent-transcript-mcp-gaps
description: >
  Within a Transcript Segment, identify MCP servers / tools that don't exist
  yet but should — moments where the agent could not close a loop because
  the relevant external system was unreachable from inside the session. Most
  often surfaced when the user tried to write a one-shot prompt and could
  not, or when the agent hand-rolled a brittle CLI workaround. Also
  seeded by analyze-agent-transcript-failure-hypothesis (missing_mcp_tool) and by
  analyze-agent-transcript-prompt-ambition (deterministic_trigger_candidate). Outputs
  proposals for new MCP servers or new tools on existing servers.
user-invocable: false
---

# Analyze MCP gaps

Per-Segment analyzer. The "what's missing" analyzer for MCP servers. Companion to `analyze-agent-transcript-mcp-trigger-performance` (which works on tools that *do* exist).

## Inputs

- `segment`: a Segment from `segments.json` (Goal, Outcome, `meta.event_range`). The orchestrator hands you the Segment directly — you do not walk raw JSONL.
- `transcript.json`: the OpenTranscripts `Transcript` document. Dereference event ids from `segment.meta.event_range` into `transcript.json` `events[]` for the turn-level evidence behind a gap.
- `available_mcp_tools`: existing tools, so we don't re-propose them. Best-effort recoverable from `transcript.json` — MCP tool surfaces appear in `SystemEvent` attachments and in the `ToolCall` events themselves; may be incompletely recoverable.
- `failure_hypothesis_seed` (optional): the `recommendation_seed` from `analyze-agent-transcript-failure-hypothesis` for this Segment, when its `recommendation_route` was `mcp` or `multi`
- `trigger_proposal_seed` (optional): the `trigger_proposal` from `analyze-agent-transcript-prompt-ambition` for this Segment, when it flagged a deterministic-trigger candidate that implies an MCP server (e.g. listening to GitHub events, watching an alert stream)
- `external_context` (optional): `external-context.json` if present.
- `philosophy_mcp`: the `philosophy-on-mcp` reference

## Output

This is the item **body**. The orchestrator wraps it with `id` / `segment_id` / `analyzer` (see the orchestrator's "Findings-item shape" section) — emit only the fields below.

```json
{
  "proposals": [
    {
      "kind": "new_server" | "new_tool_on_existing_server",
      "server": "<existing or proposed server name>",
      "tool": "<proposed tool name, if applicable>",
      "rationale": "<which heuristic this addresses — most often 'foreseeable closed-loop limitation' or 'agent hand-rolled a CLI'>",
      "evidence_events": ["<event id>", "<event id>"],
      "interface_sketch": {
        "inputs": "...",
        "output": "...",
        "auth": "<how the server would authenticate; consider what the team already runs>"
      },
      "alternative": "<could this be a Skill wrapping an existing CLI, or a hook / CI-check, instead? — see philosophy doc>"
    }
  ]
}
```

`evidence_events` cites **OpenTranscripts event ids** (the `id` strings in `transcript.json`), never integer turn numbers. **When this Segment has no gap to propose**, return nothing; the orchestrator omits the item rather than writing one with an empty `proposals` array.

## Sequencing checklist

- [ ] If a `failure_hypothesis_seed` or `trigger_proposal_seed` was passed, promote it first — flesh out the proposal with kind, server, tool, interface sketch, and alternative. Then continue scanning for additional gaps the seeds didn't cover. **But first check the defer rule below** — if the seed points at a defect in an MCP tool that already fired, do not promote it into a new-tool proposal
- [ ] Look in the Segment's events (dereferenced from `meta.event_range`) for moments where the agent reached for an external system the hard way:
  - Shelling out to `curl` / a CLI that needed credentials it didn't have
  - Asking the user to paste in data the agent could have pulled itself
  - Giving up on a step because "I don't have access to X"
- [ ] Look for moments where the user **could not write a closed-loop prompt** because of an external dependency — staging env, a prod log, a JIRA ticket, a Linear issue, a deployment system
- [ ] For each gap, decide: **new server** or **new tool on an existing server**? Reuse beats proliferation
- [ ] Sketch the interface — names, inputs, outputs, auth model
- [ ] Always evaluate the **alternative**: could a Skill that wraps an existing CLI accomplish this instead? An MCP server is the right answer when credentials, response-shape, or persistent connection make the CLI alternative brittle — the philosophy doc is the source of truth for this call

## Notes

- A common pattern from the team's playbook: closing a closed-loop gap usually requires **both** an MCP server *and* a Skill that orchestrates it. If you propose an MCP server here, also expect `analyze-agent-transcript-skill-gaps` to propose a companion Skill.
- It's fine to produce zero proposals for a clean Segment — return nothing and the orchestrator omits the item.
- **Defer to the action analyzers — don't double-count a fix.** When an existing MCP tool *fired* in this Segment and the right fix is to that tool's body, response shape, or implementation, the canonical finding is a `modify_response` / `modify_implementation` from `analyze-agent-transcript-mcp-action-performance`. Do **not** also propose a new server or tool for the same defect, even if a failure-hypothesis seed routed here. If the seed clearly targets an existing-tool defect, record the deferral (a one-line note that the fix belongs in the action recommendation) instead of proposing — `synthesize-agent-transcript-analysis-report` reconciles. Propose a new server or tool only when *no* existing tool covers the moment. The mirror of this rule lives in `analyze-agent-transcript-skill-gaps`.
- **A seed that implies a hook / CI-check has a home here.** A failure-hypothesis `recommendation_seed` or a `trigger_proposal_seed` can point at a hook or a CI-check rather than an MCP server. When the routing lands here, carry that hook/CI-check intent in the proposal's `alternative` field (state plainly "the better fix may be a hook / CI-check, not an MCP server") so it is surfaced for `synthesize-agent-transcript-analysis-report` rather than dropped. Don't discard a seed just because it isn't strictly an MCP server.
