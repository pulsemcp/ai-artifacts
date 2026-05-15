---
name: analyze-agent-transcript-segment-efficiency
description: >
  Per-Segment efficiency analyzer. Compares the Segment's actual wall-clock
  and token spend to a reasonable human-or-tighter-agent counterfactual, and
  flags two patterns: (a) wasteful branches — detours that, in hindsight,
  weren't on the critical path; (b) model-size mismatch — Segments where a
  smaller/faster model would have served, or where the chosen model was
  under-powered and the Segment thrashed. Outputs feed the Skills / MCP
  recommendation buckets when the inefficiency points at a tooling fix.
user-invocable: false
---

# Analyze segment efficiency

Per-Segment efficiency check. Runs on every Segment regardless of Outcome — Successes can still be wasteful.

## Inputs

- `segment`: a Segment from `segments.json` with its `meta` block populated (`event_range`, `wall_clock_s`, `tokens_in`, `tokens_out`, `model`). The orchestrator hands you the Segment directly — you do not walk raw JSONL.
- `parent_segment`: the parent in the Segment tree — needed to judge whether a sub-Segment's spend was proportionate to its parent Goal.
- `transcript.json`: the OpenTranscripts `Transcript` document, available to dereference event ids from `segment.meta.event_range` when you need turn-level evidence for a detour.
- `external_context` (optional): `external-context.json` if present — grounds the human counterfactual in *why* the session happened.
- `philosophy_skills`, `philosophy_mcp`: tie-breakers when proposing a tooling fix.

## Output

This is the item **body**. The orchestrator wraps it with `id` / `segment_id` / `analyzer` (see the orchestrator's "Findings-item shape" section) — emit only the fields below.

```json
{
  "spend": { "wall_clock_s": 0, "tokens_in": 0, "tokens_out": 0, "model": "..." },
  "human_counterfactual_s": 0,
  "efficiency_ratio": 0.0,
  "findings": [
    {
      "kind": "wasteful_branch" | "model_too_large" | "model_too_small" | "well_proportioned" | "meta_incomplete",
      "evidence": "<which event ids or sub-Segments are the detour, or which events retried due to model thrash>",
      "hypothesis": "<what would have made this faster / cheaper — may be null for well_proportioned / meta_incomplete>",
      "recommendation_route": "prompting" | "skills" | "mcp" | "multi" | "none"
    }
  ]
}
```

Evidence cites **OpenTranscripts event ids** (the `id` strings in `transcript.json` / `segments.json`), never integer turn numbers.

## Sequencing checklist

- [ ] Read the Segment's `meta` block. If `wall_clock_s` or the token counts are missing, **do not estimate** — emit a single `meta_incomplete` finding for this Segment (`evidence` names which `meta` fields were absent, `hypothesis: null`, `recommendation_route: "none"`) and let the orchestrator surface it. That is this analyzer's error channel; there is no other way to signal back to phase 2
- [ ] Estimate a **human counterfactual** in seconds. Heuristic: how long would a competent engineer take to achieve this Segment's stated Goal, given the same context? Be conservative; this is a rough number
- [ ] Compute `efficiency_ratio = wall_clock_s / human_counterfactual_s`. Flag thresholds:
  - ratio ≥ 5 → likely **wasteful_branch** or **model_too_small**
  - ratio ≤ 0.5 with Success → likely **well_proportioned** (the agent's edge); record but don't recommend changes
- [ ] A **`well_proportioned`** finding needs no actionable change: set `hypothesis: null` (or omit it) and `recommendation_route: "none"`. Producing no actionable hypothesis is a real outcome — do not invent a filler hypothesis for a Segment that was already proportionate. (Same stance `analyze-agent-transcript-prompt-ambition` takes for `appropriately_scoped`.)
- [ ] Identify **wasteful branches**: walk the children. For each child Segment that, in hindsight, didn't contribute to the parent's Outcome, write a `wasteful_branch` finding. Hindsight is fair game — that's the point of efficiency analysis
- [ ] Check **model-size mismatch**:
  - **model_too_large**: this Segment was rote (deterministic fix, file rename, schema migration with a clear spec). Could a smaller/cheaper model have served? Reference the model id from `meta`
  - **model_too_small**: the Segment thrashed (multiple retries, contradictory turns, abandoned and restarted). A more capable model might have one-shotted it
- [ ] For each finding, set `recommendation_route` to where the fix would live — one of `prompting` / `skills` / `mcp` / `multi` / `none`, the shared `outcomes`-bucket enum (identical to `analyze-agent-transcript-failure-hypothesis`, so `synthesize-agent-transcript-analysis-report` routes both analyzers' findings the same way). `none` is valid for `well_proportioned`; `multi` when the fix spans two buckets

## Notes

- **Don't recommend "use a cheaper model" as a default.** Model-too-large findings need a real argument; "could have used smaller" is too cheap to be useful unless it's tied to a Skill that explicitly routes the Segment.
- **Wasteful branches require hindsight evidence.** Don't flag a branch as wasteful just because it didn't pan out — flag it only when, looking at the final state, the agent could have known to skip it given a Skill, an MCP server, or a sharper prompt.
- **Efficiency is judged per-Goal, not in isolation.** A 5-minute Plan Segment that prevented a 60-minute Action mistake is well-proportioned even if wall-clock looks high.
- **Don't double-count with `analyze-agent-transcript-failure-hypothesis`.** If a Segment is a Failure, this analyzer focuses on *spend shape*, not *why it failed* — the failure hypothesis owns that.
