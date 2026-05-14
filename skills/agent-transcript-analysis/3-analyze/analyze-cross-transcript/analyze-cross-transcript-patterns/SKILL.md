---
name: analyze-cross-transcript-patterns
description: >
  Cross-cutting analyzer. Given the per-transcript findings.*.json sets of
  several already-analyzed transcripts (the tier-3 outputs of
  analyze-agent-transcript — findings.outcomes/prompts/skills/mcp.json),
  surface patterns that no single transcript reveals: Segments that could
  have been shorter with hindsight, user prompts that repeat the same nudges
  or context, recurring missing Skills / MCP tools across sessions, time-spend
  patterns where the agent consistently takes 5x what a human would. Runs on
  the raw per-transcript findings, not the synthesized reports — a report is
  already filtered to what cleared one session's report-worthiness bar, so
  cross-transcript analysis must read findings to catch the long tail that
  only matters in aggregate. Use this skill when the user wants org-wide or
  developer-wide insight, not a single-session post-mortem.
user-invocable: true
---

# Analyze cross-transcript patterns

The "step back and look at many sessions at once" analyzer. Single-transcript analysis catches per-session issues; this catches habits.

It reads the **per-transcript analysis outputs** of many transcripts — the `findings.*.json` sets — not their synthesized reports. A single-transcript `report.md` is already filtered and synthesized: only what cleared that one session's report-worthiness bar survives into it. Run cross-transcript analysis on reports and it would miss exactly the long tail it exists to catch — individually-minor findings that only become significant once they recur across many sessions. So the unit of input here is each transcript's raw findings set, not its report.

## Inputs

- `analyses` (required): a list of per-transcript inputs, one per already-analyzed transcript — each either a transcript `tmp_dir` or the set of `findings.*.json` paths within it. Each transcript contributes its tier-3 findings set: `findings.outcomes.json`, `findings.prompts.json`, `findings.skills.json`, `findings.mcp.json` (preferring any `findings.<kind>.reviewed.json` sibling a human has produced). These are the outputs of `analyze-agent-transcript`'s per-Segment analyzers — not the `report.md` / `findings.report.json` that `synthesize-report` produces. The per-transcript `segments.json` (or `segments.reviewed.json`) sits in the same `tmp_dir` and may be read alongside the findings for Segment/Trigger detail.
- `philosophy_skills`, `philosophy_mcp`: the same references the per-transcript analyzers used.

## Output

A Markdown + JSON report with these sections:

```
# Cross-transcript analysis

## Hindsight-as-foresight
  Segments that, looking across many transcripts, follow a pattern that's
  obviously suboptimal but only visible at scale. Each entry: which Segments
  exemplify it, why the shorter path was discoverable up front, and what
  Skill / MCP / prompting change would have caught it.

## Recurring prompt patterns
  Phrases / context blocks the user types repeatedly across sessions.
  Each entry: the recurring text, sessions it appears in, and a proposed
  Skill / CLAUDE.md / MCP change that would let the user stop typing it.

## Cross-session Skill gaps
  Missing Skills flagged in multiple transcripts' `findings.skills.json`.
  Each entry: the proposal, the count of sessions that surfaced it, and a
  draft body sketch that's been triangulated against the multiple contexts.

## Cross-session MCP gaps
  Same shape as Skill gaps, for MCP servers / tools.

## Time-spend patterns
  Tasks that consistently take far longer than a human would spend. Each
  entry: the task pattern (regex over Goal text + tool calls), median
  agent wall-clock, estimated human wall-clock, and the framing change that
  would close the gap.
```

### Reviewable intermediate: `findings.cross-transcript.json`

Alongside the report, write the flat list of cross-cutting conclusions to the
first input transcript's `tmp_dir` as `findings.cross-transcript.json`, in the
envelope `{kind: "cross-transcript", items: [{id, …}]}` — one item per finding
across all five sections. This is the **reviewable intermediate**: it is the
`cross-transcript` bucket `review-analysis` opens in a human-correction UI, and
`learn-from-analysis-corrections` turns those corrections into flagged
improvement opportunities for this analyzer. It is also the input
`synthesize-report` reads in its cross-transcript batch mode to turn these
findings into a recommendation slate. Emitting it is best-effort — the report
stands on its own — but it is what plugs cross-transcript analysis into the
tier-3 review loop and the tier-4 report.

## Sequencing checklist

- [ ] Load every input transcript's `findings.*.json` set (`findings.outcomes.json`, `findings.prompts.json`, `findings.skills.json`, `findings.mcp.json` — preferring any `.reviewed.json` sibling). The per-transcript `findings.*.json` items carry the Segment context they were derived from; read each transcript's `segments.json` (or `segments.reviewed.json`) alongside the findings where a step needs fuller Segment/Trigger detail
- [ ] Build a flat list of every Segment-derived finding across all transcripts, each tagged with its Trigger (kind + source), Goal, Outcome, wall-clock, source transcript id, and originating finding id
- [ ] **Hindsight-as-foresight**: cluster the `findings.outcomes.json` items (efficiency + failure-hypothesis findings) by the Goal of the Segment they were derived from; for each cluster of size ≥ 3, look at the *shortest* successful instance and ask why the longer ones didn't take that path. Propose what change would have made the short path discoverable up front
- [ ] **Recurring user-message patterns**: collect every user-source Trigger behind the `findings.prompts.json` items across transcripts (both `kind: New` and `kind: Correction`); cluster by phrasing similarity (n-gram overlap, embedding distance, or simple substring); flag any cluster that appears in ≥ 2 sessions. Each becomes a candidate for a Skill / CLAUDE.md / MCP change
- [ ] **Recurring agent-self Correction patterns**: collect the agent-source Correction Triggers behind the `findings.outcomes.json` failure-hypothesis items across transcripts and look for recurring pivot reasons (same tool error class, same wrong-path detection). These are a softer signal than user Corrections but a strong pointer at Skills the agent could have consulted to skip the dead end
- [ ] **Cross-session gaps**: deduplicate the gap proposals in `findings.skills.json` and `findings.mcp.json` across transcripts; a proposal that surfaces in ≥ 2 transcripts gets promoted with a stronger rationale
- [ ] **Time-spend patterns**: estimate a human counterfactual for each Segment cluster (the efficiency findings in `findings.outcomes.json` carry the agent wall-clock); flag those where the median agent time is ≥ 5× the estimate
- [ ] Cross-check every recommendation against the philosophy docs before emitting
- [ ] Write the flat list of findings to the first input transcript's `tmp_dir` as `findings.cross-transcript.json` — the reviewable intermediate `review-analysis` consumes

## Notes

- This skill produces **aggregate** findings — the same per-segment specificity rules apply (a finding must be concrete enough to act on), but it must also justify why the cross-cutting view changes the picture vs. any one transcript's findings.
- The input is each transcript's per-transcript **analysis output set** (`findings.*.json`), never its synthesized `report.md`. A report is already filtered to what cleared one session's report-worthiness bar — reading reports would drop the individually-minor findings that only become significant in aggregate, which is the whole point of this skill.
- Don't re-derive findings from raw JSONL here, and don't re-walk `transcript.json`. If a transcript's `segments.json` is incomplete or wrong, fix it in `2-decompose` and re-run the per-transcript analysis — don't paper over it here.
- It's fine to produce zero findings in a section. A clean result is a real outcome.
