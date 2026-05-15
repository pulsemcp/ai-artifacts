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

- `segment`: a Segment from `segments.json` whose Outcome is Failure, or whose immediately-following sibling Segment starts with a Correction trigger (either source). The orchestrator hands you the Segment directly — you do not walk raw JSONL.
- `surrounding_segments`: the parent Segment, the prior sibling, and the next sibling — needed to reason about retro-Failures and recovery.
- `transcript.json`: the OpenTranscripts `Transcript` document, available to dereference event ids from `segment.meta.event_range` when you need turn-level evidence.
- `external_context` (optional): `external-context.json` if present — grounds the hypothesis in *why* the session happened.
- `philosophy_skills`, `philosophy_mcp`: reference docs, so the hypothesis stays in line with team stance.

## Output

This is the item **body**. The orchestrator wraps it with `id` / `segment_id` / `analyzer` (see the orchestrator's "Findings-item shape" section) — emit only the fields below.

```json
{
  "failure_kind": "outright_failure"
                | "retro_failure_via_user_correction"
                | "retro_failure_via_agent_correction"
                | "failure_confirmed_by_correction",
  "root_cause_class": "missing_skill" | "non_triggering_skill"
                     | "missing_mcp_tool" | "wrong_mcp_response_shape"
                     | "prompting_issue" | "user_mistake" | "agent_reasoning_error",
  "evidence": "<event-id-level evidence: which assistant event went wrong, which correction confirmed it (user-source or agent-source)>",
  "hypothesis": "<one-paragraph improvement hypothesis>",
  "recommendation_route": "prompting" | "skills" | "mcp" | "multi" | "none",
  "recommendation_seed": "<short draft of the concrete change — promoted to a full proposal by the matching analyze-{skills,mcp}-gaps skill>"
}
```

Evidence cites **OpenTranscripts event ids** (the `id` strings in `transcript.json` / `segments.json`), never integer turn numbers.

## Sequencing checklist

- [ ] Confirm `failure_kind`:
  - **outright_failure**: Segment's Outcome is Failure in `segments.json`, *and* its next sibling does **not** open with a Correction trigger.
  - **retro_failure_via_user_correction**: Segment's Outcome is Success but the next sibling Segment opens with a Correction trigger whose `source == "user"`. Strongest retro-Failure signal — the user had to intervene.
  - **retro_failure_via_agent_correction**: Segment's Outcome is Success but the next sibling Segment opens with a Correction trigger whose `source == "agent"`. Softer signal but still actionable — the agent self-corrected, which usually means it pursued a wrong path far enough to notice.
  - **failure_confirmed_by_correction**: Segment's Outcome is Failure in `segments.json` **and** its next sibling opens with a Correction trigger — i.e. the outright-Failure and retro-Failure conditions both fire on the same Segment. Use this single value; **emit one item, not two.** Note in `evidence` which Correction source confirmed it (user-source raises urgency).
  - The orchestrator runs this analyzer when *either* condition holds; when both hold for one Segment, that is exactly the `failure_confirmed_by_correction` case — do not emit a separate item per condition.
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
- **Stay short.** One hypothesis per Segment. If you find yourself listing three independent causes, the Segment was probably under-decomposed — flag it back to phase 2 instead of papering over it here.
- **The recommendation_seed is a seed, not a finished proposal.** The corresponding `analyze-skill-gaps` / `analyze-mcp-gaps` run is responsible for fleshing it out against the philosophy docs.
- **`outcome.explanation` is the WHAT; your `hypothesis` is the WHY + WHAT-TO-DO.** For every Failure in `segments.json` the decomposer writes a one-sentence explanation of what happened to leave the Goal unmet (e.g. "`wait-for-ci` ran `gh pr checks --watch` as a single blocking call and was SIGKILL'd at exit 137"). Your `hypothesis` builds on that — name the root-cause class and the concrete change that would have prevented it. The two are complementary; do not restate `outcome.explanation` verbatim in `hypothesis`, but feel free to quote a short phrase from it as the anchor.
