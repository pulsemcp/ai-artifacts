---
name: analyze-agent-transcript-user-prompt
description: >
  Analyze a single user-source Trigger attached to a Transcript Segment.
  Classify it (question vs delegation), confirm the Segment's Goal, and
  assess whether the Segment closed the loop on that Goal. The Trigger
  kind (New vs Correction) and source (user) are already set by the
  segmenter; this skill consumes them. If the Goal isn't self-evident,
  delegate to pull-together-agent-transcript-goal-context. Output feeds the "human
  prompting" recommendation bucket of analyze-agent-transcript.
user-invocable: false
---

# Analyze user prompt

Per-user-Trigger analyzer. Invoked once per Segment whose `trigger.source == "user"`, regardless of whether `trigger.kind` is `New` or `Correction`.

## Inputs

- `segment`: a Segment from `segments.json` with `trigger.source == "user"`. Carries the message text in `trigger.text`, the kind in `trigger.kind` (New | Correction), the stated Goal, and the `meta` block (`event_range`, model, spend). The orchestrator hands you the Segment directly — you do not walk raw JSONL.
- `surrounding_segments`: parent and prior sibling — useful for grounding goal extraction and detecting whether a user-source Correction trigger was the user reacting to a Failure.
- `transcript.json`: the OpenTranscripts `Transcript` document, available to dereference event ids from `segment.meta.event_range` when surrounding events are needed.
- `external_context` (optional): `external-context.json` if present — supplies project / branch / repo / ticket context behind the session.

## Output

This is the item **body**. The orchestrator wraps it with `id` / `segment_id` / `analyzer` (see the orchestrator's "Findings-item shape" section) — emit only the fields below.

```json
{
  "trigger_kind": "New" | "Correction",
  "classification": "question" | "delegation" | "mixed",
  "goal_certainty": "high" | "medium" | "low",
  "closed_loop": true | false,
  "loop_break_reason": "<why the loop didn't close, if applicable>",
  "issues": [
    {"kind": "ambiguous" | "missing_context" | "wrong_target" | "too_broad" | "...", "evidence": "...", "fix": "..."}
  ],
  "prompting_recommendation": "<what the user should have written instead, or null>",
  "recommendation_route": "prompting" | "skills" | "mcp" | "none"
}
```

Evidence cites **OpenTranscripts event ids** (the `id` strings in `transcript.json` / `segments.json`), never integer turn numbers.

## Sequencing checklist

- [ ] Read `segment.trigger`. The kind (New | Correction) and source (user) are already set by Phase 2 — trust them
- [ ] Classify the user message (`segment.trigger.text`): is it a **question** (the user wants information back), a **delegation** (the user wants the agent to do something), or **mixed**?
- [ ] Confirm `goal_certainty`. If it would be `low`, invoke `pull-together-agent-transcript-goal-context` with the Segment and `external_context` before giving up
- [ ] Determine whether the Segment **closed the loop** on its Goal:
  - The Segment's Outcome from `segments.json` is the source of truth — Success = closed, Failure = not closed
  - If the next sibling Segment opens with a Correction trigger (either source), this Segment is a retro-Failure even if `outcome == Success`; flag it accordingly (user-source Correction is the stronger flag)
  - **`closed_loop` reflects the *prompt's* own merit**, not whether the run happened to finish. If the loop broke for a reason unrelated to the prompt — the session was killed, the harness crashed, an infra/network failure, the user revoked access mid-run — keep `closed_loop` set per whether the prompt was self-contained enough to have closed the loop, and record the external break in `loop_break_reason` explicitly tagged as non-prompt (e.g. `"non-prompt: harness crash at <event_id>"`). Don't penalize a well-formed prompt for an infra failure
- [ ] Identify prompting issues (three failure modes):
  - **Incorrect** — the user asked for the wrong thing
  - **Ambiguous** — the message left room for interpretation that hurt the Outcome
  - **Missing context** — the agent could only have succeeded with information the user didn't provide
- [ ] If a prompting issue is the root cause of a Failure or retro-Failure, write a concrete `prompting_recommendation` showing what a better version of the user message would have looked like. Set `recommendation_route` to where the fix lives (usually `prompting`; `skills` or `mcp` when the message itself was fine but the agent needed a missing tool)

## Notes

- **New vs Correction comes from Phase 2.** Don't re-derive it from message text; use `segment.trigger.kind`. Per the `transcript-segment` reference, the segmenter's heuristics (Correction phrasing at the head of the next Segment, etc.) are authoritative.
- **A user-source Correction trigger is the single strongest signal in this whole pipeline.** Any Segment immediately followed by a user-source Correction is a candidate for either a prompting fix, a Skill, or an MCP server. Even when the local Outcome is Success. (Agent-source Correction is softer — flag it but don't escalate as aggressively.)
- **Don't draft Skill or MCP artifacts here.** That's the job of `analyze-agent-transcript-skill-gaps` / `analyze-agent-transcript-mcp-gaps`. Set `recommendation_route` and let the orchestrator forward.
- **Ambition checks are a separate skill.** "Was this user-source New trigger scoped right?" lives in `analyze-agent-transcript-prompt-ambition` — don't duplicate it here.
