---
name: analyze-skill-action-performance
description: >
  For each Skill that was actually invoked in a Transcript Segment, assess
  whether it helped or hurt the Segment's Goal, and whether its token / turn
  cost was proportionate. Output recommendations to modify the body of
  Skills that underperform, or to delete Skills that are net-negative.
user-invocable: false
---

# Analyze Skill action performance

Per-Segment analyzer. Focuses on the **body** of Skills that ran — their checklists, prerequisites, and instructions — not their `description`.

## Inputs

- `segment`: a Segment from `segments.json` (Goal, Outcome, `meta.event_range`). The orchestrator hands you the Segment directly — you do not walk raw JSONL.
- `transcript.json`: the OpenTranscripts `Transcript` document. Dereference event ids from `segment.meta.event_range` into `transcript.json` `events[]` to find the `Skill` `ToolCall` events and the events they caused.
- `external_context` (optional): `external-context.json` if present.
- `philosophy_skills`: the `philosophy-on-skills` reference

## Output

This is the item **body**. The orchestrator wraps it with `id` / `segment_id` / `analyzer` (see the orchestrator's "Findings-item shape" section) — emit only the fields below.

```json
{
  "invocations": [
    {
      "skill": "...",
      "invoked_at_event": "<event id>",
      "outcome": "helpful" | "neutral" | "hurtful",
      "evidence": "...",
      "tokens_estimate": N,
      "turns_saved_estimate": "<+N | -N | unknown>",
      "closed_the_loop": true | false,
      "recommendation": {"kind": "none" | "modify" | "delete", "details": "..."}
    }
  ]
}
```

Evidence and `invoked_at_event` cite **OpenTranscripts event ids** (the `id` strings in `transcript.json`), never integer turn numbers. **When this Segment invoked no Skill**, return nothing; the orchestrator omits the item rather than writing one with an empty `invocations` array.

## Sequencing checklist

- [ ] For each `Skill` `ToolCall` in the Segment's event range, reconstruct what the Skill instructed the agent to do
- [ ] Assess outcome against the Segment's stated `goal`:
  - **helpful** — moved the Segment toward its Goal; closed-loop or got close
  - **neutral** — ran without harm but didn't really help
  - **hurtful** — the Skill nudged the agent in the wrong direction (bad instructions, outdated steps, wrong assumption about the environment)
- [ ] Estimate cost: rough token count of the Skill body + downstream turns it caused. Estimate counterfactual: would the Segment have used more or fewer turns without it?
- [ ] Recommendations:
  - **modify** — fix the specific instruction in the body that misled the agent, or trim the Skill if it's too verbose for what it delivers
  - **delete** — only if the Skill is consistently hurtful and modification can't save it (per the philosophy doc)
- [ ] Cross-check against the `philosophy-on-skills` reference

## Notes

- A Skill that was perfectly fine in this Segment should produce `kind: "none"` — don't manufacture work.
- If a Skill that *was* invoked correctly was then ignored by the agent, that's worth flagging — sometimes the body needs a more imperative tone, sometimes the harness has a configuration issue.
- **A `modify` here is the *owner* of any defect in an existing Skill's body or shape.** When a Skill fired and the fix is to its body, this analyzer's `modify` recommendation is the canonical finding — `analyze-skill-gaps` must **not** also propose a new Skill for the same defect (it defers to this finding). If a failure-hypothesis seed pointed `analyze-skill-gaps` at the same defect, expect the gap analyzer to record the deferral and let `synthesize-report` reconcile to this `modify`.
