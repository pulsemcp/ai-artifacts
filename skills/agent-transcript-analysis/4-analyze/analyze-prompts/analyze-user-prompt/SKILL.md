---
name: analyze-user-prompt
description: >
  Analyze a single user-source Trigger attached to a Transcript Segment.
  Classify it (question vs delegation), confirm the Segment's Goal, and
  assess whether the Segment closed the loop on that Goal. The Trigger
  kind (New vs Correction) and source (user) are already set by the
  segmenter; this skill consumes them. If the Goal isn't self-evident,
  delegate to pull-together-goal-context. Output feeds the "human
  prompting" recommendation bucket of analyze-agent-transcript.
user-invocable: false
---

# Analyze user prompt

Per-user-Trigger analyzer. Invoked once per Segment whose `trigger.source == "user"`, regardless of whether `trigger.kind` is `New` or `Correction`.

## Inputs

- `segment`: a Segment from `segments.json` with `trigger.source == "user"`. Carries the message text in `trigger.text`, the kind in `trigger.kind` (New | Correction), and the stated Goal.
- `surrounding_segments`: parent and prior sibling — useful for grounding goal extraction and detecting whether a user-source Correction trigger was the user reacting to a Failure.
- `manifest`: from the tmp folder, for project / branch / repo context.

## Output

```json
{
  "segment_id": "...",
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

## Sequencing checklist

- [ ] Read `segment.trigger`. The kind (New | Correction) and source (user) are already set by Tier 2 — trust them
- [ ] Classify the user message (`segment.trigger.text`): is it a **question** (the user wants information back), a **delegation** (the user wants the agent to do something), or **mixed**?
- [ ] Confirm `goal_certainty`. If it would be `low`, invoke `pull-together-goal-context` with the project/branch info from the manifest before giving up
- [ ] Determine whether the Segment **closed the loop** on its Goal:
  - The Segment's Outcome from `segments.json` is the source of truth — Success = closed, Failure = not closed
  - If the next sibling Segment opens with a Correction trigger (either source), this Segment is a retro-Failure even if `outcome == Success`; flag it accordingly (user-source Correction is the stronger flag)
- [ ] Identify prompting issues (three failure modes):
  - **Incorrect** — the user asked for the wrong thing
  - **Ambiguous** — the message left room for interpretation that hurt the Outcome
  - **Missing context** — the agent could only have succeeded with information the user didn't provide
- [ ] If a prompting issue is the root cause of a Failure or retro-Failure, write a concrete `prompting_recommendation` showing what a better version of the user message would have looked like. Set `recommendation_route` to where the fix lives (usually `prompting`; `skills` or `mcp` when the message itself was fine but the agent needed a missing tool)

## Notes

- **New vs Correction comes from Tier 2.** Don't re-derive it from message text; use `segment.trigger.kind`. Per `references/transcript-segment.md`, the segmenter's heuristics (Correction phrasing at the head of the next Segment, etc.) are authoritative.
- **A user-source Correction trigger is the single strongest signal in this whole pipeline.** Any Segment immediately followed by a user-source Correction is a candidate for either a prompting fix, a Skill, or an MCP server. Even when the local Outcome is Success. (Agent-source Correction is softer — flag it but don't escalate as aggressively.)
- **Don't draft Skill or MCP artifacts here.** That's the job of `analyze-skill-gaps` / `analyze-mcp-gaps`. Set `recommendation_route` and let the orchestrator forward.
- **Ambition checks are a separate skill.** "Was this user-source New trigger scoped right?" lives in `analyze-prompt-ambition` — don't duplicate it here.
