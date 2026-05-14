# `analyze-cross-transcript-patterns`

The labeling skill of tier 4's `analyze-cross-transcript` bucket. Operates on the consolidated reports of many already-analyzed transcripts — the across-sessions counterpart to the per-Segment analyzers in the other tier-4 buckets.

## How it plugs in

Upstream: a batch of single-transcript reports produced by `analyze-agent-transcript`.
Downstream: its findings feed `synthesize-report` in tier 5 — the same as every other tier-4 bucket. This skill produces *findings* ("this pattern recurs in N sessions"); turning them into a prioritized change list is `synthesize-report`'s job.

Unlike the per-Segment analyzers, it is not fanned out by the orchestrator — it is invoked directly with a batch of reports.

## Design decisions

- **Clustering, not enumeration.** Findings come from clusters of similar Segments / Prompts. A single anomaly belongs in the per-transcript report, not here.
- **Hindsight ↔ foresight.** Every flagged pattern must come with a concrete change (Skill, CLAUDE.md, MCP, hook, or prompting habit) that would have let the team see the short path *up front*.
- **Trust the segment tree.** If a cross-session call hinges on data that should be in `segments.json` but isn't, escalate to tier 2 — don't reconstruct from JSONL.
- **Cross-session repetition outranks novelty.** A small-scope recommendation that fires in 5 transcripts often beats a clever one-off recommendation that fires in 1.
- **Labeling, not synthesis.** It lives in tier 4 because it produces findings, not the final recommendation slate. Its *scope* is many transcripts; its *kind* of work is labeling.
