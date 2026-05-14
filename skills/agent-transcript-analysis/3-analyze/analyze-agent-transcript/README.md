# `analyze-agent-transcript`

The orchestrator — and the entry point of the analyze tier. Use this when you want a full single-session analysis: one invocation drives a transcript through per-Segment analysis (tier 3) and synthesis (tier 4), on top of the Segment tree decomposition (tier 2) produced first.

## How it plugs in

Upstream: consumes the tmp folder produced by `get-claude-code-transcript-from-local` (and, when present, the `external-context.json` from `gather-external-context`). Decomposition (tier 2) is a hard prerequisite — this skill needs `segments.json` and will invoke `decompose-agent-transcript-into-transcript-segments` to produce it if the tmp folder doesn't already have one.

With `segments.json` in hand, it drives, in order:

1. **Tier 3 (this tier)**, per Segment, across four buckets:
   - `analyze-outcomes/` — `analyze-segment-efficiency`, `analyze-failure-hypothesis`.
   - `analyze-prompts/` — `analyze-user-prompt`, `analyze-prompt-ambition`, helper `pull-together-goal-context`.
   - `analyze-skills/` — trigger / action / gaps.
   - `analyze-mcp/` — trigger / action / gaps.
2. Writes each bucket's conclusions to `tmp_dir` as `findings.{outcomes,prompts,skills,mcp}.json` — the reviewable intermediate `review-analysis` consumes.
3. **Tier 4**: invokes `synthesize-report` against those findings — its last step. `synthesize-report` makes the leap from findings to recommendations and writes `findings.report.json` (reviewable) and `report.md` (the human-readable consolidated report).

Downstream of this orchestrator: `analyze-cross-transcript-patterns` consumes many transcripts' `report.md` at once.

The tier-3 analyzers and `synthesize-report` are not the supported entry point — invoke them directly only when debugging, or when running `synthesize-report` on a cross-transcript batch.

## Design decisions

- **The Transcript Segment is the analysis primitive.** This orchestrator does not walk raw JSONL; it requires `segments.json` from tier 2 and operates on the tree. If the tree is wrong, fix tier 2 — don't paper over it here.
- **Decomposition is a prerequisite, not something this tier orchestrates.** Tier 2 runs first and concretely. This skill bootstraps it if the tmp folder is missing `segments.json`, but that is satisfying a precondition — the orchestrator's actual job begins once the Segment tree exists. It is the front door of tier 3, not a tier sitting between decompose and analyze.
- **Drive, don't synthesize.** The orchestrator sequences the analyzers and passes shared context between them. It does not aggregate findings, dedupe recommendations, cross-check philosophy, or compute the north-star block — that synthesis is `synthesize-report`'s job (tier 4), given its own tier so the leap from findings to recommendations gets its own review checkpoint. The orchestrator's responsibility ends at well-formed `findings.<kind>.json`.
- **Four buckets in this tier.** The orchestrator drives four tier-3 buckets (`analyze-outcomes`, `analyze-prompts`, `analyze-skills`, `analyze-mcp`). `analyze-outcomes` produces *Segment-shaped* findings (failure hypotheses, efficiency) that carry a `recommendation_route`; `synthesize-report` follows that route when it folds findings into the three output buckets (Prompting / Skills / MCP).
- **Run efficiency on Successes too.** A 30-minute Success on a 5-minute Goal is the most under-flagged failure mode. The orchestrator runs `analyze-segment-efficiency` on every Segment regardless of Outcome.
- **Findings carry stable ids.** Every item in a `findings.<kind>.json` gets a unique `id` — `synthesize-report` cites those ids in each recommendation's `sources` list, which is what makes the leap from analysis to recommendations auditable.
