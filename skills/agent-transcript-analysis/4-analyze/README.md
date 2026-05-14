# Tier 4: `4-analyze`

The labeling layer. Five sibling buckets, each turning transcripts and Segments into structured findings. Four are per-Segment and driven by the orchestrator (Tier 3); the fifth, `analyze-cross-transcript/`, works across many transcripts' reports and runs separately.

## Buckets in this tier

- `analyze-outcomes/` — Segment-shaped findings: failure hypotheses and efficiency. (`analyze-failure-hypothesis`, `analyze-segment-efficiency`)
- `analyze-prompts/` — human-prompting recommendations. (`analyze-user-prompt`, `analyze-prompt-ambition`, helper `pull-together-goal-context`)
- `analyze-skills/` — Skill recommendations. (trigger / action / gaps)
- `analyze-mcp/` — MCP recommendations. (trigger / action / gaps)
- `analyze-cross-transcript/` — patterns across many already-analyzed transcripts. (`analyze-cross-transcript-patterns`) Same *kind* of work — labeling — but a wider *scope*: it consumes consolidated reports, not Segments, and is invoked directly rather than fanned out by the orchestrator.

Each bucket has its own README explaining how its skills relate.

## How this tier plugs into the rest

The four per-Segment buckets are driven by Tier 3 (`analyze-agent-transcript`), once per Segment. Each analyzer emits a structured finding the orchestrator aggregates into the final report's three buckets (Prompting / Skills / MCP). `analyze-cross-transcript/` is not fanned out by the orchestrator — it is invoked directly with a batch of consolidated reports once several transcripts have been analyzed.

Analyzers in this tier do **not** read raw JSONL — the per-Segment buckets read Segments from `segments.json` produced by Tier 2; `analyze-cross-transcript/` reads the consolidated reports. If a Segment field is missing or wrong, fix Tier 2 and re-run; don't patch around it here.

`external-context.json` (from tier 1's `gather-external-context`, or its reviewed sibling) is available in the same `tmp_dir` and every analyzer is free to read it — the ticket, PR, and user context behind the session sharpen judgments about whether a Goal was the right one and whether an Outcome really succeeded. It is best-effort: analyzers must still produce a finding when it is absent. The narrower, on-demand counterpart is `pull-together-goal-context`, which reaches out only when a specific Segment's Goal is still unclear.

## Design decisions

- **Three artifact-shaped buckets, one Segment-shaped bucket.** Prompts / Skills / MCP correspond to the three final-report buckets. `analyze-outcomes` is different in kind — it asks "did this Segment fail" and "was it efficient" — and routes its findings *into* the three artifact buckets via the gap analyzers.
- **Symmetric trigger / action / gaps split** inside `analyze-skills/` and `analyze-mcp/`. Knowing which lever to pull (description, body, or new artifact) matters as much for MCP as for Skills.
- **No cross-bucket recommendations.** A prompt analyzer never proposes a Skill artifact; a Skill analyzer never rewrites a prompt. The outcomes bucket is the only one that legitimately points at multiple downstream buckets, and it does so via `recommendation_route` rather than by drafting the artifact itself.
- **The Segment is the unit, not the message.** Every per-Segment analyzer's input is a Segment (plus its neighbors / parent as needed). Never re-walk JSONL.
- **Cross-transcript lives here because it is labeling, not synthesis.** `analyze-cross-transcript/` produces findings ("this pattern recurs in N sessions"), the same kind of output as the per-Segment buckets — it just operates on consolidated reports instead of Segments. Tier 4 is all the labeling; turning labels into a prioritized change list is tier 5's job. The folder hierarchy reflects *kind* of work, not scope.
