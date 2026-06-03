---
name: analyze-agent-transcript
description: >
  Orchestrator for analyzing a single Claude Code session transcript. Takes
  the tmp folder produced by get-claude-code-transcript-from-local, requires
  the Segment tree from decompose-agent-transcript-into-transcript-segments
  (invoking it if the tmp folder doesn't already have one), drives the
  per-Segment analyzers across four buckets (outcomes, prompts, skills, mcp)
  and writes their conclusions as findings.<kind>.json — and stops there. It
  produces only that transcript's four findings files; there is no
  per-transcript report. The report is a batch-end step: once every transcript
  of interest has been analyzed, synthesize-agent-transcript-analysis-report runs once over the whole
  batch's findings. Use this skill when the user wants a single session
  analyzed, a "how could this have gone better" review, or to surface
  Skill/MCP opportunities from real usage.
user-invocable: true
---

# Analyze agent transcript

The orchestrator and the entry point of the analyze phase. One invocation turns a session into that transcript's four `findings.*.json` files — the structured, reviewable labels for one session.

It **drives**; it does not itself decompose or analyze, and it has nothing to do with the report. Decomposition (phase 2) runs first and concretely — it builds the Segment tree; this skill then sequences the phase-3 analyzers that label it. Its job ends at well-formed `findings.*.json`. There is no per-transcript report: the report is a batch-level step that runs once, later, over every analyzed transcript's findings — `synthesize-agent-transcript-analysis-report` (phase 4), which this skill never invokes.

The Transcript Segment is the analysis primitive. See the `transcript-segment` reference for the data model. This skill does not walk raw JSONL — it asks `decompose-agent-transcript-into-transcript-segments` for `segments.json` and reads only from there.

## Inputs

- `tmp_dir` (required): output of `get-claude-code-transcript-from-local`. Must contain `transcript.json` (an OpenTranscripts `Transcript` document, subagents embedded recursively).
- `external_context` (optional): `external-context.json` in the same `tmp_dir`, produced by `gather-agent-transcript-external-context`. The ticket, PR, and user context behind the session. When present, pass it through to phase 2 and the phase-3 analyzers so Goal/Outcome judgments are grounded in *why* the session happened. Best-effort: absent is fine, never fatal.
- `philosophy_skills` (optional): the `philosophy-on-skills` reference. Defaults to the bundled copy. Available to the phase-3 analyzers.
- `philosophy_mcp` (optional): the `philosophy-on-mcp` reference. Defaults to the bundled copy. Available to the phase-3 analyzers.
- `philosophy_prompting` (optional): the `philosophy-on-prompting` reference. Defaults to the bundled copy. Available to the phase-3 prompts-bucket analyzers (`analyze-agent-transcript-user-prompt`, `analyze-agent-transcript-prompt-ambition`).
- `transcript_segment_spec` (optional): the `transcript-segment` reference. Defaults to the bundled copy.

## Outputs

This skill's outputs are the **four phase-3 findings files** for this one transcript, and nothing else. It also ensures the **Segment tree** exists as its phase-2 prerequisite. All land in `tmp_dir`:

- `segments.json` + `flamegraph.html` — produced by phase 2 (`decompose-agent-transcript-into-transcript-segments`), the prerequisite this skill bootstraps if it is missing.
- `findings.outcomes.json`, `findings.prompts.json`, `findings.skills.json`, `findings.mcp.json` — the flat lists of conclusions from the four phase-3 buckets, one file per bucket, in the envelope `{kind, items: [{id, …}]}`. These are the **durable substrate** of the pipeline — they accumulate across transcripts and are what the batch-level steps (`analyze-cross-agent-transcript-patterns`, `synthesize-agent-transcript-analysis-report`) read.

This skill does **not** produce a report. There is no per-transcript report, and this skill does not invoke `synthesize-agent-transcript-analysis-report`. Aggregation, dedup, the philosophy cross-check, the north-star block, and the report itself are all phase 4's job, run once over the whole batch after every transcript has been analyzed. The orchestrator's responsibility begins at `segments.json` and ends at well-formed `findings.*.json`.

## Sequencing checklist

- [ ] **Pick up external context if it exists.** Check `tmp_dir` for `external-context.json`. If present, hold it as shared context for phase 2 and every phase-3 analyzer. If absent, proceed — it is best-effort, never required.
- [ ] **Satisfy the decomposition prerequisite (phase 2's job).** If `tmp_dir` doesn't already hold `segments.json`, invoke `decompose-agent-transcript-into-transcript-segments` with `tmp_dir` to produce it (plus `flamegraph.html`). Either way, decomposition runs to completion before any analysis begins. Do **not** walk raw JSONL from this skill — that's phase 2's job, exclusively.
- [ ] Load `segments.json`. The Segment tree is now the unit of analysis.
- [ ] For each Segment, in tree order (parent before children, or vice versa — the analyzers don't care, but findings reference Segment ids), run the per-Segment analyzers in this order:
  - [ ] **Outcomes bucket** (always):
    - [ ] `analyze-agent-transcript-segment-efficiency` — runs on every Segment
    - [ ] `analyze-agent-transcript-failure-hypothesis` — runs only when the Segment's Outcome is Failure, or when the next sibling Segment opens with a Correction trigger (retro-Failure). Both `source: user` and `source: agent` Corrections qualify; user-source is the stronger signal. **If both conditions hold for one Segment** (outright Failure *and* a next-sibling user Correction), the analyzer emits **one** item, not two — pick the `failure_kind` that covers both (see that skill's `failure_kind` enum)
  - [ ] **Prompts bucket** (only on Segments with `trigger.source == "user"`):
    - [ ] `analyze-agent-transcript-user-prompt` — on every Segment whose Trigger came from a user message
    - [ ] `analyze-agent-transcript-prompt-ambition` — only on Segments with `trigger.kind == "New" && trigger.source == "user"` (the user-typed Initial case)
  - [ ] **Skills bucket** (every Segment):
    - [ ] `analyze-agent-transcript-skill-trigger-performance`
    - [ ] `analyze-agent-transcript-skill-action-performance`
    - [ ] `analyze-agent-transcript-skill-gaps` — seeded by any `recommendation_seed` from this Segment's failure hypothesis
  - [ ] **MCP bucket** (every Segment):
    - [ ] `analyze-agent-transcript-mcp-trigger-performance`
    - [ ] `analyze-agent-transcript-mcp-action-performance`
    - [ ] `analyze-agent-transcript-mcp-gaps` — seeded by any `recommendation_seed` from this Segment's failure hypothesis and any deterministic-trigger candidate from `analyze-agent-transcript-prompt-ambition`
- [ ] Write each bucket's conclusions to `tmp_dir` as `findings.<kind>.json` (`outcomes` / `prompts` / `skills` / `mcp`). Each is the `{kind, items: [{id, …}]}` envelope. **The orchestrator stamps the wrapper fields on every item it writes** — see "Findings-item shape" below — so an analyzer only ever returns the item *body*. **This is the orchestrator's last step** — it writes the four findings files and stops
- [ ] Surface the four `findings.*.json` paths to the user. Note that the report is a batch-end step: once the user has analyzed every transcript of interest, `analyze-cross-agent-transcript-patterns` (optional) and then `synthesize-agent-transcript-analysis-report` run once over the whole batch. Do **not** invoke `synthesize-agent-transcript-analysis-report` from here

## Findings-item shape

Every item inside a `findings.<kind>.json` `items[]` array has the same three wrapper fields, **stamped by this orchestrator** — the analyzers never set them. An analyzer returns only the item *body* (the analyzer-specific object documented in its own SKILL.md); the orchestrator wraps it:

- `id` — unique within the file. The orchestrator stamps it as `{analyzer-short-name}-{segment_id}` (e.g. `segment-efficiency-S0.3`, `failure-hypothesis-S0`). If one analyzer emits more than one item for the same Segment, suffix the extras `-2`, `-3`, … So a finding can always be cited as a `source` later.
- `segment_id` — the Segment that was analyzed, or `null` for a whole-transcript item. Stamped from the Segment the analyzer was handed.
- `analyzer` — the producing analyzer's registered `name` (e.g. `analyze-agent-transcript-segment-efficiency`). Stamped by the orchestrator.

So the on-disk item is `{id, segment_id, analyzer, …body fields…}`. Each analyzer's SKILL.md documents the body; this section documents the wrapper.

**Evidence references are OpenTranscripts event ids**, never integer "turn" indices. When an analyzer's body cites a moment (the assistant turn that went wrong, where a Skill fired, etc.), it cites the `id` string of the relevant event in `transcript.json` / `segments.json` — `cc-line-117`, `1e81436d-855c-…`, `7d87e5ff-…:tool:0`. There is no stable "turn number" in an OpenTranscripts document; an event id is the only durable cite.

**Omit empty items — no filler.** `analyze-skill-*` and `analyze-mcp-*` run on every Segment, but most Segments invoke zero Skills and zero MCP tools. When an analyzer has **no signal** for the Segment it was handed (no invocations, no false positives/negatives, no proposals), the orchestrator **omits the item entirely** — it does not write a padded item with empty arrays. A `findings.<kind>.json` therefore contains one item per *Segment-with-signal*, not one per Segment. (`analyze-agent-transcript-segment-efficiency` is the exception — it produces a real `well_proportioned` judgment for every Segment, so its items are never empty filler.)

## Out of scope

- Acquiring the transcript — that's `get-claude-code-transcript-from-local`.
- Producing `segments.json` — that's `decompose-agent-transcript-into-transcript-segments`. This skill requires that output and bootstraps it if absent, but the decomposition work itself is phase 2's, exclusively.
- The actual per-Segment scoring — that's the phase-3 analyzers this orchestrator drives.
- **The report — entirely.** There is no per-transcript report. Aggregation, dedup, routing into Prompting/Skills/MCP, the philosophy cross-check, the distance-from-ideal north-star block, `findings.report.json`, and `report.md` are all `synthesize-agent-transcript-analysis-report`'s job (phase 4), run once over the whole batch. This skill never invokes `synthesize-agent-transcript-analysis-report` and produces nothing report-shaped.
- Cross-session patterns — that's `analyze-cross-agent-transcript-patterns`, in phase 3's `analyze-cross-transcript` bucket, run as a batch-level step over many transcripts' findings.
