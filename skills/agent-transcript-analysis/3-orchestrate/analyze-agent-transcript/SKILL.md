---
name: analyze-agent-transcript
description: >
  Orchestrator for analyzing a single Claude Code session transcript. Takes
  the tmp folder produced by get-claude-code-transcript-from-local, invokes
  decompose-agent-transcript-into-transcript-segments to produce the Segment
  tree, drives the per-Segment analyzers across four buckets (outcomes,
  prompts, skills, mcp) and writes their conclusions as findings.<kind>.json,
  then invokes synthesize-report to turn those findings into the consolidated
  report of actionable recommendations across human prompting, Skills, and MCP
  servers. Use this skill when the user wants a full single-session analysis, a
  "how could this have gone better" review, or to surface Skill/MCP
  opportunities from real usage.
user-invocable: true
---

# Analyze agent transcript

The orchestrator. It drives a transcript through the whole pipeline — decomposition, per-Segment analysis, and synthesis — so that one invocation turns a session into an actionable list of changes to the user's prompting habits, the Skill portfolio, and the MCP server portfolio.

It **drives**; it does not itself decompose, analyze, or synthesize. Tier 2 builds the Segment tree, the tier-4 analyzers label it, and tier 5's `synthesize-report` makes the leap from those labels to recommendations. This skill sequences those tiers and passes shared context between them.

The Transcript Segment is the analysis primitive. See the `transcript-segment` reference for the data model. This skill does not walk raw JSONL — it asks `decompose-agent-transcript-into-transcript-segments` for `segments.json` and reads only from there.

## Inputs

- `tmp_dir` (required): output of `get-claude-code-transcript-from-local`. Must contain `transcript.json` (an OpenTranscripts `Transcript` document, subagents embedded recursively).
- `external_context` (optional): `external-context.json` — or `external-context.reviewed.json` — in the same `tmp_dir`, produced by `gather-external-context`. The ticket, PR, and user context behind the session. When present, pass it through to tier 2, the tier-4 analyzers, and `synthesize-report` so Goal/Outcome judgments and recommendations are grounded in *why* the session happened. Best-effort: absent is fine, never fatal.
- `philosophy_skills` (optional): the `philosophy-on-skills` reference. Defaults to the bundled copy. Passed through to `synthesize-report`.
- `philosophy_mcp` (optional): the `philosophy-on-mcp` reference. Defaults to the bundled copy. Passed through to `synthesize-report`.
- `transcript_segment_spec` (optional): the `transcript-segment` reference. Defaults to the bundled copy.

## Outputs

This skill's direct outputs are the **Segment tree** and the **four tier-4 findings files** — and, by invoking `synthesize-report` as its last step, the **consolidated report**. All land in `tmp_dir`:

- `segments.json` + `flamegraph.html` — produced by tier 2 (`decompose-agent-transcript-into-transcript-segments`).
- `findings.outcomes.json`, `findings.prompts.json`, `findings.skills.json`, `findings.mcp.json` — the flat lists of conclusions from the four tier-4 buckets, one file per bucket, in the envelope `{kind, items: [{id, …}]}`. These are the **reviewable intermediate**: `review-analysis` opens any of them in a human-correction UI, and `learn-from-analysis-corrections` turns those corrections into flagged improvement opportunities for the analyzers.
- `findings.report.json` + `report.md` — produced by tier 5 (`synthesize-report`), invoked by this skill once the findings are written. `findings.report.json` is the reviewable recommendation slate; `report.md` is the human-readable consolidated report, including the distance-from-ideal north-star block.

The orchestrator does **not** itself aggregate findings, dedupe recommendations, cross-check against the philosophy docs, or compute the north-star block — that synthesis is `synthesize-report`'s job, given its own tier so the leap from findings to recommendations is reviewable (`review-report`) and improvable (`learn-from-report-corrections`). The orchestrator's responsibility ends at producing well-formed findings and handing them to tier 5.

## Sequencing checklist

- [ ] **Pick up external context if it exists.** Check `tmp_dir` for `external-context.json` (prefer `external-context.reviewed.json`). If present, hold it as shared context for tier 2, every tier-4 analyzer, and `synthesize-report`. If absent, proceed — it is best-effort, never required.
- [ ] **Decompose first.** Invoke `decompose-agent-transcript-into-transcript-segments` with `tmp_dir`. It produces `segments.json` and `flamegraph.html` in `tmp_dir`. Do **not** walk raw JSONL from this skill — that's tier 2's job, exclusively.
- [ ] Load `segments.json`. The Segment tree is now the unit of analysis.
- [ ] For each Segment, in tree order (parent before children, or vice versa — the analyzers don't care, but findings reference Segment ids), run the per-Segment analyzers in this order:
  - [ ] **Outcomes bucket** (always):
    - [ ] `analyze-segment-efficiency` — runs on every Segment
    - [ ] `analyze-failure-hypothesis` — runs only when the Segment's Outcome is Failure, or when the next sibling Segment opens with a Correction trigger (retro-Failure). Both `source: user` and `source: agent` Corrections qualify; user-source is the stronger signal
  - [ ] **Prompts bucket** (only on Segments with `trigger.source == "user"`):
    - [ ] `analyze-user-prompt` — on every Segment whose Trigger came from a user message
    - [ ] `analyze-prompt-ambition` — only on Segments with `trigger.kind == "New" && trigger.source == "user"` (the user-typed Initial case)
  - [ ] **Skills bucket** (every Segment):
    - [ ] `analyze-skill-trigger-performance`
    - [ ] `analyze-skill-action-performance`
    - [ ] `analyze-skill-gaps` — seeded by any `recommendation_seed` from this Segment's failure hypothesis
  - [ ] **MCP bucket** (every Segment):
    - [ ] `analyze-mcp-trigger-performance`
    - [ ] `analyze-mcp-action-performance`
    - [ ] `analyze-mcp-gaps` — seeded by any `recommendation_seed` from this Segment's failure hypothesis and any deterministic-trigger candidate from `analyze-prompt-ambition`
- [ ] Write each bucket's conclusions to `tmp_dir` as `findings.<kind>.json` (`outcomes` / `prompts` / `skills` / `mcp`) — the reviewable intermediate `review-analysis` consumes. Each is the `{kind, items: [{id, …}]}` envelope; every item needs a unique `id` so a finding can be cited as a `source` later
- [ ] **Hand off to synthesis.** Invoke `synthesize-report` with `tmp_dir` (and the external context + philosophy refs held above). It reads the `findings.<kind>.json` set — preferring any `findings.<kind>.reviewed.json` a human has already produced — and writes `findings.report.json` and `report.md`. This is the orchestrator's last step
- [ ] Surface the report path to the user, and point them at the optional review checkpoints — `review-analysis` over the `findings.<kind>.json` drafts, `review-report` over `findings.report.json`

## Out of scope

- Acquiring the transcript — that's `get-claude-code-transcript-from-local`.
- Producing `segments.json` — that's `decompose-agent-transcript-into-transcript-segments`.
- The actual per-Segment scoring — that's the tier-4 analyzers below this orchestrator.
- **Synthesizing the findings into the consolidated report** — aggregation, dedup, routing into Prompting/Skills/MCP, the philosophy cross-check, the distance-from-ideal north-star block, and the report itself are all `synthesize-report`'s job (tier 5). This skill invokes it; it does not do that work.
- Human review of the findings or the report — that's `review-analysis` (tier 4) and `review-report` (tier 5).
- Cross-session patterns — that's `analyze-cross-transcript-patterns`, in tier 4's `analyze-cross-transcript` bucket.
