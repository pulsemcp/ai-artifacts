# `analyze-outcomes` bucket

The Segment-level analysis bucket. Where `analyze-prompts/`, `analyze-skills/`, and `analyze-mcp/` slice the transcript by *artifact type*, this bucket slices it by *Segment Outcome and shape*: did this Segment fail, was it efficient, was the work it did proportionate?

## Skills in this bucket

- `analyze-failure-hypothesis/` — every Failure Outcome (and every retro-Failure surfaced by a Correction trigger at the next Segment's head — user-source or agent-source) gets a concrete improvement hypothesis.
- `analyze-segment-efficiency/` — wall-clock / token spend vs a reasonable counterfactual. Flags wasteful branches and model-tier mismatches.

## How the skills interplay

`analyze-agent-transcript` runs both per Segment. `analyze-failure-hypothesis` answers "why did this Segment fail and what would have prevented it"; `analyze-segment-efficiency` answers "even on Successes, where did time and tokens go that shouldn't have." The two are complementary — a Segment can be Success-but-wasteful, or Failure-but-fast-fail.

Output from this bucket *does not* directly map to one of the final report's three buckets — instead, each finding declares, via a `recommendation_route`, which downstream bucket(s) (Prompting / Skills / MCP) its recommendation flows to. `synthesize-report` (tier 5) follows that route when it folds the findings into the report.

## Design decisions

- **Outcome-shaped analysis lives here, not in the orchestrator.** The orchestrator stays a coordinator; the actual judgment about "this Segment failed because X" lives in a Skill that can be improved independently.
- **Hypothesis, not verdict.** Failure analysis produces *improvement hypotheses* — they may be wrong. Calling them hypotheses keeps the report honest and invites the human reviewer to challenge them.
- **Efficiency is per-Goal, not per-Segment-in-isolation.** A 10-minute Plan Segment that prevented a 2-hour Action mistake is efficient. The analyzer must reason about the Segment in the context of its parent Goal.
- **No cross-bucket recommendations.** This bucket produces findings *about* Segments; concrete artifact changes (new Skill, new MCP server) are still drafted by the `analyze-skills/` and `analyze-mcp/` buckets, prompted by these findings.
