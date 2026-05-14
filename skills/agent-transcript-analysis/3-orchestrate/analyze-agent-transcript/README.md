# `analyze-agent-transcript`

The orchestrator. Use this when you want a full single-session analysis — the entry point to the tier-2 decomposer and all four tier-4 analyzer buckets, and the only skill that emits an aggregated, consolidated report.

## How it plugs in

Upstream: consumes the tmp folder produced by `get-claude-code-transcript`.

Drives, in order:

1. **Tier 2**: `decompose-into-transcript-segments` to produce `segments.json` and `flamegraph.html` in the tmp folder.
2. **Tier 4**, per Segment, across four buckets:
   - `analyze-outcomes/` — `analyze-segment-efficiency`, `analyze-failure-hypothesis`.
   - `analyze-prompts/` — `analyze-user-prompt`, `analyze-prompt-ambition`, helper `pull-together-goal-context`.
   - `analyze-skills/` — trigger / action / gaps.
   - `analyze-mcp/` — trigger / action / gaps.

Aggregates everything into the three output buckets: Prompting, Skills, MCP.

Downstream of this orchestrator: `5-cross-transcript/analyze-cross-transcript-patterns` consumes many of these reports at once.

The tier-4 analyzers are not the supported entry point — invoke them directly only when debugging.

## Design decisions

- **The Transcript Segment is the analysis primitive.** This orchestrator does not walk raw JSONL; it asks tier 2 for `segments.json` and operates on the tree. If the tree is wrong, fix tier 2 — don't paper over it here.
- **Four buckets in tier 4, three in the output.** The new `analyze-outcomes/` bucket produces *Segment-shaped* findings (failure hypotheses, efficiency); those findings route to the Prompting / Skills / MCP buckets via the gap analyzers. Clean separation, single output shape.
- **Run efficiency on Successes too.** A 30-minute Success on a 5-minute Goal is the most under-flagged failure mode. The orchestrator runs `analyze-segment-efficiency` on every Segment regardless of Outcome.
- **North-star block is required.** The final report carries a "distance from ideal end-state" paragraph — count of Failures, Corrections, deterministic-trigger candidates, wall-clock vs counterfactual. Without it, the team can't see whether sessions are getting better over time.
- **Philosophy docs gate the final report.** Recommendations that conflict with `philosophy-on-{skills,mcp}.md` are dropped or flagged before they reach the user.
- **Actionable or silent.** Segments that produce no real recommendation are reported as "no change needed."
