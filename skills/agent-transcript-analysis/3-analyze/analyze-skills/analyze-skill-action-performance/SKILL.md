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

- `segment`: a Segment from `segments.json` (Goal, Outcome, turn_range)
- `segment_turns`: the raw turns within `segment.meta.turn_range` from `main.jsonl`
- `philosophy_skills`: the `philosophy-on-skills` reference

## Output

```json
{
  "invocations": [
    {
      "skill": "...",
      "turn": N,
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

## Sequencing checklist

- [ ] For each Skill invocation in `segment_turns`, reconstruct what the Skill instructed the agent to do
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
