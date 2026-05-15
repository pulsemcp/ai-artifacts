# `analyze-agent-transcript`

The orchestrator — and the entry point of the analyze phase. Use this to analyze one transcript: one invocation drives it through per-Segment analysis (phase 3) on top of the Segment tree decomposition (phase 2) produced first, and ends at that transcript's four `findings.*.json` files. There is no per-transcript report — the report is a batch-end step.

## How it plugs in

Upstream: consumes the tmp folder produced by `get-claude-code-transcript-from-local` (and, when present, the `external-context.json` from `gather-agent-transcript-external-context`). Decomposition (phase 2) is a hard prerequisite — this skill needs `segments.json` and will invoke `decompose-agent-transcript-into-transcript-segments` to produce it if the tmp folder doesn't already have one.

With `segments.json` in hand, it drives, in order:

1. **Phase 3 (this phase)**, per Segment, across four buckets:
   - `analyze-outcomes/` — `analyze-agent-transcript-segment-efficiency`, `analyze-agent-transcript-failure-hypothesis`.
   - `analyze-prompts/` — `analyze-agent-transcript-user-prompt`, `analyze-agent-transcript-prompt-ambition`, helper `pull-together-agent-transcript-goal-context`.
   - `analyze-skills/` — trigger / action / gaps.
   - `analyze-mcp/` — trigger / action / gaps.
2. Writes each bucket's conclusions to `tmp_dir` as `findings.{outcomes,prompts,skills,mcp}.json` — the reviewable intermediate `review-agent-transcript-analysis` consumes. **That is the last step.** The orchestrator stops here.

It does **not** produce a report and does **not** invoke `synthesize-agent-transcript-analysis-report`. The report is a batch-level artifact: once every transcript of interest has been through phases 1–3, `analyze-cross-agent-transcript-patterns` (optional) and then `synthesize-agent-transcript-analysis-report` (phase 4) run once each over the whole batch's findings.

Downstream of this orchestrator: the per-transcript `findings.*.json` sets accumulate, one set per transcript. `analyze-cross-agent-transcript-patterns` and `synthesize-agent-transcript-analysis-report` are the batch-level consumers of those sets.

The phase-3 analyzers are not the supported entry point — invoke them directly only when debugging.

## Design decisions

- **The Transcript Segment is the analysis primitive.** This orchestrator does not walk raw JSONL; it requires `segments.json` from phase 2 and operates on the tree. If the tree is wrong, fix phase 2 — don't paper over it here.
- **Decomposition is a prerequisite, not something this phase orchestrates.** Phase 2 runs first and concretely. This skill bootstraps it if the tmp folder is missing `segments.json`, but that is satisfying a precondition — the orchestrator's actual job begins once the Segment tree exists. It is the front door of phase 3, not a phase sitting between decompose and analyze.
- **Drive, don't synthesize — and don't report.** The orchestrator sequences the analyzers and passes shared context between them. It does not aggregate findings, dedupe recommendations, cross-check philosophy, compute the north-star block, or produce a report — there is no per-transcript report, and this skill never invokes `synthesize-agent-transcript-analysis-report`. The synthesis is phase 4's job, run once over the whole batch. The orchestrator's responsibility ends at well-formed `findings.<kind>.json`.
- **Per transcript, not per batch.** This skill runs once per transcript and produces one transcript's findings. You repeat it for every transcript in the batch; the findings sets accumulate. The batch-level steps (`analyze-cross-agent-transcript-patterns`, `synthesize-agent-transcript-analysis-report`) run later, once, over all of them.
- **Four buckets in this phase.** The orchestrator drives four phase-3 buckets (`analyze-outcomes`, `analyze-prompts`, `analyze-skills`, `analyze-mcp`). `analyze-outcomes` produces *Segment-shaped* findings (failure hypotheses, efficiency) that carry a `recommendation_route`; `synthesize-agent-transcript-analysis-report` follows that route when it folds findings into the three output buckets (Prompting / Skills / MCP).
- **Run efficiency on Successes too.** A 30-minute Success on a 5-minute Goal is the most under-flagged failure mode. The orchestrator runs `analyze-agent-transcript-segment-efficiency` on every Segment regardless of Outcome.
- **Findings carry stable ids.** Every item in a `findings.<kind>.json` gets a unique `id` — `synthesize-agent-transcript-analysis-report` cites those ids in each recommendation's `sources` list, which is what makes the leap from analysis to recommendations auditable.
