---
name: analyze-failure-hypothesis
description: >
  Per-Segment analyzer. Produces an improvement hypothesis for every Failure
  Outcome and every retro-Failure (a Correction trigger at the next Segment's
  head implies the prior Segment failed even if it didn't recognize it).
  Both user-source and agent-source Corrections qualify as retro-Failure
  signals; user-source is the stronger signal. Each hypothesis names the
  most plausible root cause — usually a missing Skill, a Skill whose
  description didn't trigger, a missing MCP capability, or a user-side
  prompting issue — and the concrete change that would have prevented the
  failure. Fed by analyze-agent-transcript; outputs flow into the Prompting
  / Skills / MCP recommendation buckets of the final report.
user-invocable: false
---

# Analyze failure hypothesis

Per-Segment analyzer for Failure Outcomes and retro-Failures.

## Inputs

- `segment`: a Segment from `segments.json` whose Outcome is Failure, or whose immediately-following sibling Segment starts with a Correction trigger (either source).
- `surrounding_segments`: the parent Segment, the prior sibling, and the next sibling — needed to reason about retro-Failures and recovery.
- `philosophy_skills`, `philosophy_mcp`: reference docs, so the hypothesis stays in line with team stance.

## Output

```json
{
  "segment_id": "...",
  "failure_kind": "outright_failure"
                | "retro_failure_via_user_correction"
                | "retro_failure_via_agent_correction",
  "root_cause_class": "missing_skill" | "non_triggering_skill"
                     | "missing_mcp_tool" | "wrong_mcp_response_shape"
                     | "prompting_issue" | "user_mistake" | "agent_reasoning_error",
  "evidence": "<turn-level evidence: which assistant turn went wrong, which correction confirmed it (user-source or agent-source)>",
  "hypothesis": "<one-paragraph improvement hypothesis>",
  "recommendation_route": "prompting" | "skills" | "mcp" | "multi" | "none",
  "recommendation_seed": "<short draft of the concrete change — promoted to a full proposal by the matching analyze-{skills,mcp}-gaps skill>"
}
```

## Sequencing checklist

- [ ] Confirm `failure_kind`:
  - **outright_failure**: Segment's Outcome is Failure in `segments.json`.
  - **retro_failure_via_user_correction**: Segment's Outcome is Success but the next sibling Segment opens with a Correction trigger whose `source == "user"`. Strongest retro-Failure signal — the user had to intervene.
  - **retro_failure_via_agent_correction**: Segment's Outcome is Success but the next sibling Segment opens with a Correction trigger whose `source == "agent"`. Softer signal but still actionable — the agent self-corrected, which usually means it pursued a wrong path far enough to notice.
  - Trust the segmenter's classification — don't second-guess by re-reading raw JSONL.
- [ ] Classify the `root_cause_class`. Decision order:
  1. Was there a Skill or MCP tool that *should have triggered*? → `non_triggering_skill` or `missing_skill` / `missing_mcp_tool`.
  2. Did a Skill or tool fire but produce the wrong shape / didn't close the loop? → `wrong_mcp_response_shape` or a Skill action issue (defer that to `analyze-skill-action-performance`).
  3. Was the prompt itself wrong (ambiguous, missing context, asking for the wrong thing)? → `prompting_issue`.
  4. None of the above → `agent_reasoning_error`, then `user_mistake` only when explicitly justified.
- [ ] Write the **hypothesis** in one paragraph: what would have prevented this exact Segment from failing? Be concrete enough that someone reading it could write the PR or rewrite the prompt.
- [ ] Set `recommendation_route` to the downstream bucket the hypothesis points at — one of `prompting` / `skills` / `mcp` / `multi` / `none`, the shared `outcomes`-bucket enum (identical to `analyze-segment-efficiency`). `multi` is acceptable when prompting *and* a Skill change would both help; `none` is rare here — a Failure almost always implies a fix somewhere — but is kept so both `outcomes` analyzers share one enum.
- [ ] Write a `recommendation_seed` — one-to-three sentences the matching gap analyzer can promote into a full proposal.

## Notes

- **The default cause of a Correction is a Skill issue, not a user mistake.** Per the `transcript-segment` reference, this is the team's prior — only override it with explicit evidence. Applies whether the Correction came from the user or from the agent self-correcting.
- **Weight retro-Failure recommendations by Correction source.** A `retro_failure_via_user_correction` deserves a more forceful hypothesis (user-visible failure mode) than `retro_failure_via_agent_correction` (agent recovered on its own — still worth fixing, but lower urgency).
- **Don't propagate failure up the tree.** A leaf Failure does not automatically make its parent a Failure; the segmenter already made that call. Analyze the Segment you were handed.
- **Stay short.** One hypothesis per Segment. If you find yourself listing three independent causes, the Segment was probably under-decomposed — flag it back to tier 2 instead of papering over it here.
- **The recommendation_seed is a seed, not a finished proposal.** The corresponding `analyze-skill-gaps` / `analyze-mcp-gaps` run is responsible for fleshing it out against the philosophy docs.
