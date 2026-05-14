---
name: analyze-prompt-ambition
description: >
  Per-user-source-New-Trigger analyzer (the case formerly known as the
  Initial Prompt). Flags user-typed Triggers that look like they
  under-scoped the work — short, narrow, followed quickly by another
  user-source New Trigger on a related Goal. Pattern suggests the user
  split work the agent could have one-shotted with a more ambitious
  prompt. Output feeds the human-prompting recommendation bucket, and may
  also surface deterministic-trigger opportunities (the ideal end-state
  for user-source New Triggers).
user-invocable: false
---

# Analyze prompt ambition

Per-Segment ambition check. Runs only on Segments with `trigger.kind == "New" && trigger.source == "user"` — i.e. user-typed prompts that opened a fresh Goal, the case formerly known as Initial Prompts.

## Inputs

- `segment`: a Segment with `trigger.kind == "New"` and `trigger.source == "user"`.
- `next_user_new_segments`: the next 1-3 Segments in the same Transcript with the same Trigger shape (`kind: New, source: user`) — needed to detect the "user split work" pattern.
- `manifest`: project / branch context, useful for spotting recurring user-triggers that should be deterministic.

## Output

```json
{
  "segment_id": "...",
  "ambition_finding": "unambitious" | "appropriately_scoped" | "ambitious",
  "evidence": {
    "wall_clock_s": 0,
    "next_user_new_within_s": 0,
    "next_user_new_goal_overlap": "high" | "medium" | "low" | "none"
  },
  "deterministic_trigger_candidate": true | false,
  "trigger_proposal": "<if true: which external event (alert, schedule, PR open, etc.) should have fired this prompt instead of the user typing it>",
  "prompting_recommendation": "<what a single more-ambitious prompt would have looked like, or null>"
}
```

## Sequencing checklist

- [ ] Confirm `segment.trigger.kind == "New" && segment.trigger.source == "user"`. If not, return early — this skill only applies to user-typed New Triggers.
- [ ] Pull the Segment's wall-clock from `meta`. If short (< a few minutes by default) **and** the next user-source New Trigger fires soon after **and** that next prompt's Goal overlaps this one's, flag as `unambitious`.
- [ ] If `unambitious`, draft a `prompting_recommendation`: what one combined prompt would have set both Goals up front?
- [ ] Independently, ask: **does this user-typed New Trigger look like an ad-hoc reaction to an external event** (alert, ticket, schedule, PR opening, build break)? If yes, set `deterministic_trigger_candidate = true` and draft a `trigger_proposal` naming the system that should have fired the prompt instead. This is the north-star case per the `transcript-segment` reference.
- [ ] For `appropriately_scoped` and `ambitious`, set the recommendation fields to null. Producing no finding is a real outcome.

## Notes

- **Ambition is not "longer prompts."** A 1-sentence prompt that sets up a whole well-scoped piece of work is *more* ambitious than a 4-paragraph prompt that hand-holds the agent through every step.
- **Deterministic trigger candidacy is the higher-leverage finding** when it applies. The team's stated end-state is that user-typed New Triggers move toward event-triggered invocation over time; flagging candidates is how we make that gradient visible.
- **Don't blame the user for splitting work that *had* to be split.** If the next user-source New Trigger's Goal genuinely depends on the outcome of this one, that's correct scoping, not under-ambition. Use the overlap signal to distinguish them.
- **Stay in the prompting bucket.** This skill does not recommend Skills or MCP servers directly; if a deterministic trigger candidate implies an MCP server is needed, hand the seed to `analyze-mcp-gaps` via the orchestrator.
