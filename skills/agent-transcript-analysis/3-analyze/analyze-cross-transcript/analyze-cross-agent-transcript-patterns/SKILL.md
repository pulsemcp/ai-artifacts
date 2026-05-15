---
name: analyze-cross-agent-transcript-patterns
description: >
  Cross-cutting analyzer. Given the per-transcript findings.*.json sets of
  several already-analyzed transcripts (the phase-3 outputs of
  analyze-agent-transcript — findings.outcomes/prompts/skills/mcp.json),
  surface patterns that no single transcript reveals: Segments that could
  have been shorter with hindsight, user prompts that repeat the same nudges
  or context, recurring missing Skills / MCP tools across sessions, time-spend
  patterns where the agent consistently takes 5x what a human would. Still
  phase-3 labeling, but runs once over the whole batch — last in phase 3, after
  every transcript has been analyzed — as an optional pre-report augmentation,
  not interleaved per transcript and not fanned out by the orchestrator. Runs
  on the raw per-transcript findings; there is no per-transcript report, and
  reading raw findings is what catches the long tail that only matters in
  aggregate. Writes findings.cross-transcript.json into the batch_dir for
  synthesize-agent-transcript-analysis-report to pick up. Use this skill when the user wants org-wide or
  developer-wide insight across a batch of sessions.
user-invocable: true
---

# Analyze cross-transcript patterns

The "step back and look at many sessions at once" analyzer. Per-transcript analysis catches per-session issues; this catches habits.

It runs **once, last in phase 3** — after every transcript in the batch has been analyzed — as an optional pre-report augmentation. It is not interleaved per transcript and not fanned out by `analyze-agent-transcript`; it is run on its own over the whole batch, then `synthesize-agent-transcript-analysis-report` runs after it.

It reads the **per-transcript analysis outputs** of many transcripts — the `findings.*.json` sets. There is no per-transcript report to read. The unit of input is each transcript's raw findings set, and that is the point: reading raw findings is what catches the long tail this skill exists to find — individually-minor findings that only become significant once they recur across many sessions.

## Inputs

- `transcripts` (required): the list of per-transcript `tmp_dir`s that make up the batch — one per already-analyzed transcript. Each contributes its phase-3 findings set: `findings.outcomes.json`, `findings.prompts.json`, `findings.skills.json`, `findings.mcp.json` (preferring any `findings.<kind>.reviewed.json` sibling a human has produced). These are the outputs of `analyze-agent-transcript`'s per-Segment analyzers — not the `report.md` / `findings.report.json` that `synthesize-agent-transcript-analysis-report` produces. The per-transcript `segments.json` (or `segments.reviewed.json`) sits in the same `tmp_dir` and may be read alongside the findings for Segment/Trigger detail. Every findings item carries `id` (unique within its file), `segment_id`, `analyzer`, plus analyzer-specific fields; evidence references are OpenTranscripts event ids, never integer turn indices.
- Per-transcript findings files may diverge in id scheme across orchestrator runs — different runs may number their items differently. Treat finding ids as unique batch-wide and cite them as-is; don't assume a uniform scheme across transcripts.
- `batch_dir` (optional): the batch-level working directory `findings.cross-transcript.json` is written into — distinct from any single transcript's `tmp_dir`. Defaults to a new tmp dir created for the batch. `synthesize-agent-transcript-analysis-report` reads this same `batch_dir`.
- `philosophy_skills`, `philosophy_mcp`: the same references the per-transcript analyzers used.

## Output

Two artifacts, both written into `batch_dir`: the human-readable Markdown report
`cross-transcript-analysis.md`, and the reviewable-intermediate
`findings.cross-transcript.json` (described below). The Markdown report has these
sections:

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

### Thresholds unreachable at small batch sizes

Some sections have thresholds that **structurally cannot fire** on a small
batch: "Hindsight-as-foresight" needs a Goal cluster of size ≥ 3, and
"Time-spend patterns" needs a median over a cluster — neither can be reached on a
2- or 3-transcript batch. When a section's threshold is unreachable at the
current batch size, **say so explicitly in that section** ("threshold not
reachable at N=2") rather than rendering an empty section. This is a distinct
case from "examined the batch, genuinely clean" — keep the two honest and
separate. Don't lower the thresholds to compensate; just label which case the
empty section is.

### Reviewable intermediate: `findings.cross-transcript.json`

Alongside the report, write the flat list of cross-cutting conclusions to the
`batch_dir` as `findings.cross-transcript.json`, in the same
`{kind, items: [{id, …}]}` envelope every phase-3 findings file uses, with
`kind: "cross-transcript"` — one item per finding across all five sections. Each
item carries:

```jsonc
{
  "id":                 "ct-001",          // unique within this file
  "section":            "Hindsight-as-foresight", // which of the 5 sections
  "title":              "<short actionable headline>",
  "summary":            "<the cross-cutting conclusion, in prose>",
  "evidence":           "<the recurring text / Goal pattern / counts that ground it>",
  "source_finding_ids": ["<per-transcript finding id>", "..."], // the findings this aggregates
  "transcripts":        ["<source_transcript_id>", "..."],      // sessions it spans
  "proposed_change":    "<the Skill / CLAUDE.md / MCP / framing change it implies>"
}
```

`source_finding_ids` points back at the per-transcript finding ids this item
aggregates (cited as-is — see the Inputs note on heterogeneous id schemes), the
same way `synthesize-agent-transcript-analysis-report`'s `sources` makes its leap auditable. This is the
**reviewable intermediate**: it is the
`cross-transcript` bucket `review-agent-transcript-analysis` opens in a human-correction UI, and
`learn-from-agent-transcript-analysis-corrections` turns those corrections into flagged
improvement opportunities for this analyzer. It is also the optional input
`synthesize-agent-transcript-analysis-report` reads from `batch_dir` to fold these cross-cutting findings
into the batch's recommendation slate. Emitting it is best-effort — the report
stands on its own — but it is what plugs cross-transcript analysis into the
phase-3 review loop and the phase-4 report.

## Sequencing checklist

- [ ] Resolve `batch_dir` (use the one given, or create a new tmp dir for the batch). Load every transcript's `findings.*.json` set from the `transcripts` `tmp_dir`s (`findings.outcomes.json`, `findings.prompts.json`, `findings.skills.json`, `findings.mcp.json` — preferring any `.reviewed.json` sibling). The per-transcript `findings.*.json` items carry the Segment context they were derived from; read each transcript's `segments.json` (or `segments.reviewed.json`) alongside the findings where a step needs fuller Segment/Trigger detail
- [ ] Build a flat list of every Segment-derived finding across all transcripts, each tagged with its Trigger (kind + source), Goal, Outcome, wall-clock, source transcript id, and originating finding id
- [ ] **Hindsight-as-foresight**: cluster the `findings.outcomes.json` items (efficiency + failure-hypothesis findings) by the Goal of the Segment they were derived from; for each cluster of size ≥ 3, look at the *shortest* successful instance and ask why the longer ones didn't take that path. Propose what change would have made the short path discoverable up front
- [ ] **Recurring user-message patterns**: collect every user-source Trigger behind the `findings.prompts.json` items across transcripts (both `kind: New` and `kind: Correction`); cluster by phrasing similarity (n-gram overlap, embedding distance, or simple substring); flag any cluster that appears in ≥ 2 sessions. Each becomes a candidate for a Skill / CLAUDE.md / MCP change
- [ ] **Recurring agent-self Correction patterns**: collect the agent-source Correction Triggers behind the `findings.outcomes.json` failure-hypothesis items across transcripts and look for recurring pivot reasons (same tool error class, same wrong-path detection). These are a softer signal than user Corrections but a strong pointer at Skills the agent could have consulted to skip the dead end
- [ ] **Cross-session gaps**: deduplicate the gap proposals in `findings.skills.json` and `findings.mcp.json` across transcripts; a proposal that surfaces in ≥ 2 transcripts gets promoted with a stronger rationale
- [ ] **Time-spend patterns**: estimate a human counterfactual for each Segment cluster (the efficiency findings in `findings.outcomes.json` carry the agent wall-clock); flag those where the median agent time is ≥ 5× the estimate
- [ ] Cross-check every recommendation against the philosophy docs before emitting
- [ ] Write the flat list of findings to the `batch_dir` as `findings.cross-transcript.json` — the reviewable intermediate `review-agent-transcript-analysis` consumes, and the optional pre-report input `synthesize-agent-transcript-analysis-report` picks up from the same `batch_dir`

## Notes

- This skill produces **aggregate** findings — the same per-segment specificity rules apply (a finding must be concrete enough to act on), but it must also justify why the cross-cutting view changes the picture vs. any one transcript's findings.
- The input is each transcript's per-transcript **analysis output set** (`findings.*.json`), never its synthesized `report.md`. A report is already filtered to what cleared one session's report-worthiness bar — reading reports would drop the individually-minor findings that only become significant in aggregate, which is the whole point of this skill.
- Don't re-derive findings from raw JSONL here, and don't re-walk `transcript.json`. If a transcript's `segments.json` is incomplete or wrong, fix it in `2-decompose` and re-run the per-transcript analysis — don't paper over it here.
- It's fine to produce zero findings in a section. A clean result is a real outcome.
