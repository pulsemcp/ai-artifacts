# Phase 3: `3-analyze`

The labeling layer — and the pipeline's supported entry point. `analyze-agent-transcript` is the front door: it picks up the Segment tree from phase 2, fans out the per-Segment analyzers, and writes that transcript's findings. It stops there — it does not hand off to phase 4. Around it sit five sibling analyzer buckets, each turning transcripts and Segments into structured findings, plus a human-in-the-loop review loop over whatever findings the buckets emit.

## The entry point

- `analyze-agent-transcript/` — the orchestrator. The supported entry point for analysis: one invocation turns a single session into that transcript's `findings.{outcomes,prompts,skills,mcp}.json` set, and stops. It **drives**; it does not itself decompose or analyze, and it has nothing to do with the report. Decomposition (phase 2) is its concrete prerequisite — it picks up `segments.json` rather than walking raw JSONL. The orchestrator sequences the per-Segment analyzers and passes shared context between them; the leap from findings to recommendations is phase 4's `synthesize-report`, run once over the whole batch, which the orchestrator never invokes.

## Buckets in this phase

- `analyze-outcomes/` — Segment-shaped findings: failure hypotheses and efficiency. (`analyze-failure-hypothesis`, `analyze-segment-efficiency`)
- `analyze-prompts/` — human-prompting recommendations. (`analyze-user-prompt`, `analyze-prompt-ambition`, helper `pull-together-goal-context`)
- `analyze-skills/` — Skill recommendations. (trigger / action / gaps)
- `analyze-mcp/` — MCP recommendations. (trigger / action / gaps)
- `analyze-cross-transcript/` — patterns across many already-analyzed transcripts. (`analyze-cross-transcript-patterns`) Same *kind* of work — labeling — but a wider *scope*: it consumes many transcripts' per-transcript `findings.*.json` sets, not a single transcript's Segments. It runs **once, last in phase 3** — after every transcript in the batch has been analyzed — as an optional pre-report augmentation, not interleaved per transcript and not fanned out by the orchestrator. It reads the raw per-transcript findings, never any report — there is no per-transcript report, and the batch report is downstream of it.

Each bucket has its own README explaining how its skills relate.

## How this phase plugs into the rest

Decomposition (phase 2) runs first: `decompose-agent-transcript-into-transcript-segments` produces `segments.json`. `analyze-agent-transcript` picks that up and drives the four per-Segment buckets, once per Segment. Each analyzer emits a structured finding; the orchestrator collects them into the transcript's `findings.<kind>.json` set and stops there — it never invokes phase 4. Phases 1–3 repeat per transcript, and the findings sets accumulate, one set per transcript in its own `tmp_dir`. Once the batch is complete, `analyze-cross-transcript/` runs once over all those transcripts' `findings.*.json` sets — last in phase 3, an optional pre-report step — and then phase 4's `synthesize-report` runs once over the whole batch to make the leap into the final report's three buckets (Prompting / Skills / MCP).

Analyzers in this phase do **not** read raw JSONL — the per-Segment buckets read Segments from `segments.json` produced by phase 2; `analyze-cross-transcript/` reads the per-transcript `findings.*.json` sets (and the `segments.json` they were derived from). There is no per-transcript report for any analyzer to read. If a Segment field is missing or wrong, fix phase 2 and re-run; don't patch around it here.

`external-context.json` (from phase 1's `gather-external-context`, or its reviewed sibling) is available in the same `tmp_dir` and every analyzer is free to read it — the ticket, PR, and user context behind the session sharpen judgments about whether a Goal was the right one and whether an Outcome really succeeded. It is best-effort: analyzers must still produce a finding when it is absent. The narrower, on-demand counterpart is `pull-together-goal-context`, which reaches out only when a specific Segment's Goal is still unclear.

## The review loop

The five buckets emit AI *drafts*. Two skills at this phase's root close a human-in-the-loop loop over them — they are not buckets, so they sit at `3-analyze/` root rather than inside one:

- `review-analysis` — opens a localhost UI over any one `findings.<kind>.json` draft (the flat list of conclusions a bucket produced), one finding at a time: thumbs-up, correct a field, or reject. Saving writes a `findings.<kind>.reviewed.json` sibling with full correction provenance; the draft is never touched. Optional, but every correction it captures sharpens the next analysis.
- `learn-from-analysis-corrections` — reads those reviewed siblings across one or more transcripts, clusters the corrections into recurring patterns, and flags concrete improvement opportunities for the analyzer that drafted them. It flags; it never edits a skill.

`review-analysis` is parametrised by `kind` and reviews any of the five findings lists (the four per-Segment buckets plus `analyze-cross-transcript`). This pair mirrors phase 2's `review-transcript-segments` / `learn-from-segment-corrections`, pointed at the phase-3 findings instead of the Segment tree.

## Design decisions

- **The orchestrator is this phase's entry point, not a phase of its own.** `analyze-agent-transcript` used to carry its own phase number, sitting between decompose and analyze. But nothing flows *through* orchestration — it is the conductor, not a pipeline stage. Folding it in as phase 3's front door fixes the false implication. Decomposition stays a concrete phase-2 step that runs first; the orchestrator picks up its output.
- **Only one orchestrator, by design.** Multiple competing orchestrators would split the pipeline's shape and lose the single-entry-point benefit. If the orchestrator needs to be specialized, it should grow optional inputs, not get cloned. Per-domain analyzers should not be invoked directly except when debugging.
- **Drive, don't synthesize — and don't report.** The orchestrator fans out to four buckets (`analyze-outcomes`, `analyze-prompts`, `analyze-skills`, `analyze-mcp`) and writes their findings — and stops. The aggregation, dedup, philosophy cross-check, and the three-bucket recommendation slate are `synthesize-report`'s job, in phase 4, run once over the whole batch — and the orchestrator never invokes it. There is no per-transcript report. Synthesis got its own phase so the leap from findings to recommendations is reviewable on its own; the orchestrator's responsibility ends at well-formed `findings.<kind>.json` for the one transcript it was given.
- **Three artifact-shaped buckets, one Segment-shaped bucket.** Prompts / Skills / MCP correspond to the three final-report buckets. `analyze-outcomes` is different in kind — it asks "did this Segment fail" and "was it efficient" — and routes its findings *into* the three artifact buckets via the gap analyzers.
- **Symmetric trigger / action / gaps split** inside `analyze-skills/` and `analyze-mcp/`. Knowing which lever to pull (description, body, or new artifact) matters as much for MCP as for Skills.
- **No cross-bucket recommendations.** A prompt analyzer never proposes a Skill artifact; a Skill analyzer never rewrites a prompt. The outcomes bucket is the only one that legitimately points at multiple downstream buckets, and it does so via `recommendation_route` rather than by drafting the artifact itself.
- **The Segment is the unit, not the message.** Every per-Segment analyzer's input is a Segment (plus its neighbors / parent as needed). Never re-walk JSONL.
- **Cross-transcript lives here because it is labeling, not synthesis.** `analyze-cross-transcript/` produces findings ("this pattern recurs in N sessions"), the same kind of output as the per-Segment buckets — it just operates on many transcripts' per-transcript `findings.*.json` sets instead of one transcript's Segments. It reads those raw findings: there is no per-transcript report, and running on raw findings is what catches the long tail that only matters in aggregate. It runs once, last in phase 3, over the whole batch — an optional pre-report augmentation — rather than being interleaved per transcript or fanned out by the orchestrator. Phase 3 is all the labeling; turning labels into a prioritized change list is phase 4's job. The folder hierarchy reflects *kind* of work, not scope.
- **The review loop lives at the phase root, not in a bucket.** `review-analysis` and `learn-from-analysis-corrections` are bucket-agnostic — `review-analysis` reviews any `findings.<kind>.json` regardless of which analyzer drafted it. Putting them inside a bucket would falsely imply they belong to it. They sit at `3-analyze/` root for the same reason `review-transcript-segments` sits at `2-decompose/` root: a review checkpoint is a sibling of the thing it reviews, not a child of it.
