# `analyze-agent-transcript`

The orchestrator. Use this when you want a full single-session analysis — it is the entry point that drives a transcript through decomposition (tier 2), per-Segment analysis (tier 4), and synthesis (tier 5) in one invocation.

## How it plugs in

Upstream: consumes the tmp folder produced by `get-claude-code-transcript-from-local` (and, when present, the `external-context.json` from `gather-external-context`).

Drives, in order:

1. **Tier 2**: `decompose-agent-transcript-into-transcript-segments` to produce `segments.json` and `flamegraph.html` in the tmp folder.
2. **Tier 4**, per Segment, across four buckets:
   - `analyze-outcomes/` — `analyze-segment-efficiency`, `analyze-failure-hypothesis`.
   - `analyze-prompts/` — `analyze-user-prompt`, `analyze-prompt-ambition`, helper `pull-together-goal-context`.
   - `analyze-skills/` — trigger / action / gaps.
   - `analyze-mcp/` — trigger / action / gaps.
3. Writes each bucket's conclusions to `tmp_dir` as `findings.{outcomes,prompts,skills,mcp}.json` — the reviewable intermediate `review-analysis` consumes.
4. **Tier 5**: invokes `synthesize-report` against those findings — its last step. `synthesize-report` makes the leap from findings to recommendations and writes `findings.report.json` (reviewable) and `report.md` (the human-readable consolidated report).

Downstream of this orchestrator: `analyze-cross-transcript-patterns` consumes many transcripts' `report.md` at once.

The tier-4 analyzers and `synthesize-report` are not the supported entry point — invoke them directly only when debugging, or when running `synthesize-report` on a cross-transcript batch.

## Design decisions

- **The Transcript Segment is the analysis primitive.** This orchestrator does not walk raw JSONL; it asks tier 2 for `segments.json` and operates on the tree. If the tree is wrong, fix tier 2 — don't paper over it here.
- **Drive, don't synthesize.** The orchestrator sequences the tiers and passes shared context between them. It does not aggregate findings, dedupe recommendations, cross-check philosophy, or compute the north-star block — that synthesis is `synthesize-report`'s job (tier 5), given its own tier so the leap from findings to recommendations gets its own review checkpoint. The orchestrator's responsibility ends at well-formed `findings.<kind>.json`.
- **Four buckets in tier 4.** The orchestrator drives four tier-4 buckets (`analyze-outcomes`, `analyze-prompts`, `analyze-skills`, `analyze-mcp`). `analyze-outcomes` produces *Segment-shaped* findings (failure hypotheses, efficiency) that carry a `recommendation_route`; `synthesize-report` follows that route when it folds findings into the three output buckets (Prompting / Skills / MCP).
- **Run efficiency on Successes too.** A 30-minute Success on a 5-minute Goal is the most under-flagged failure mode. The orchestrator runs `analyze-segment-efficiency` on every Segment regardless of Outcome.
- **Findings carry stable ids.** Every item in a `findings.<kind>.json` gets a unique `id` — `synthesize-report` cites those ids in each recommendation's `sources` list, which is what makes the leap from analysis to recommendations auditable.
