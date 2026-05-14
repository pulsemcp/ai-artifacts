---
name: analyze-cross-transcript-patterns
description: >
  Cross-cutting analyzer. Given the consolidated reports of several already-
  analyzed transcripts (each produced by analyze-agent-transcript), surface
  patterns that no single transcript reveals: Segments that could have been
  shorter with hindsight, user prompts that repeat the same nudges or
  context, recurring missing Skills / MCP tools across sessions, time-spend
  patterns where the agent consistently takes 5x what a human would. Use
  this skill when the user wants org-wide or developer-wide insight, not a
  single-session post-mortem.
user-invocable: true
---

# Analyze cross-transcript patterns

The "step back and look at many sessions at once" analyzer. Single-transcript analysis catches per-session issues; this catches habits.

## Inputs

- `reports` (required): list of paths to consolidated reports produced by `analyze-agent-transcript`. Each carries the segment tree, per-segment findings, and aggregated recommendations.
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
  Missing Skills proposed in multiple single-transcript reports. Each entry:
  the proposal, the count of sessions that surfaced it, and a draft body
  sketch that's been triangulated against the multiple contexts.

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
first input report's `tmp_dir` as `findings.cross-transcript.json`, in the
envelope `{kind: "cross-transcript", items: [{id, …}]}` — one item per finding
across all five sections. This is the **reviewable intermediate**: it is the
`cross-transcript` bucket `review-analysis` opens in a human-correction UI, and
`learn-from-analysis-corrections` turns those corrections into flagged
improvement opportunities for this analyzer. Emitting it is best-effort — the
report stands on its own — but it is what plugs cross-transcript analysis into
the tier-3 review loop.

## Sequencing checklist

- [ ] Load every input report's `segments.json` and aggregated recommendations
- [ ] Build a flat list of every Segment across all transcripts, with its Trigger (kind + source), Goal, Outcome, wall-clock, and source report id
- [ ] **Hindsight-as-foresight**: cluster Segments by Goal similarity; for each cluster of size ≥ 3, look at the *shortest* successful instance and ask why the longer ones didn't take that path. Propose what change would have made the short path discoverable up front
- [ ] **Recurring user-message patterns**: collect every user-source Trigger across reports (both `kind: New` and `kind: Correction`); cluster by phrasing similarity (n-gram overlap, embedding distance, or simple substring); flag any cluster that appears in ≥ 2 sessions. Each becomes a candidate for a Skill / CLAUDE.md / MCP change
- [ ] **Recurring agent-self Correction patterns**: collect agent-source Correction Triggers across reports and look for recurring pivot reasons (same tool error class, same wrong-path detection). These are a softer signal than user Corrections but a strong pointer at Skills the agent could have consulted to skip the dead end
- [ ] **Cross-session gaps**: deduplicate the Skill-gap and MCP-gap proposals across reports; a proposal that surfaces in ≥ 2 reports gets promoted with a stronger rationale
- [ ] **Time-spend patterns**: estimate a human counterfactual for each Segment cluster; flag those where the median agent time is ≥ 5× the estimate
- [ ] Cross-check every recommendation against the philosophy docs before emitting
- [ ] Write the flat list of findings to the first input report's `tmp_dir` as `findings.cross-transcript.json` — the reviewable intermediate `review-analysis` consumes

## Notes

- This skill produces **aggregate** recommendations — the same per-segment specificity rules apply (a recommendation must be concrete enough to act on), but it must also justify why the cross-cutting view changes the picture vs. the per-transcript report.
- Don't re-derive findings from raw JSONL here. If a report's `segments.json` is incomplete or wrong, fix it in `2-decompose` and re-run the per-transcript analysis.
- It's fine to produce zero findings in a section. A clean report is a real outcome.
