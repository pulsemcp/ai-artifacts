# `analyze-cross-transcript-patterns`

The only skill in tier 5. Operates on the consolidated reports of many already-analyzed transcripts.

## How it plugs in

Upstream: a batch of single-transcript reports produced by `3-orchestrate/analyze-agent-transcript`.
Downstream: emits an aggregate report. There's nothing below this tier.

## Design decisions

- **Clustering, not enumeration.** Findings come from clusters of similar Segments / Prompts. A single anomaly belongs in the per-transcript report, not here.
- **Hindsight ↔ foresight.** Every flagged pattern must come with a concrete change (Skill, CLAUDE.md, MCP, hook, or prompting habit) that would have let the team see the short path *up front*.
- **Trust the segment tree.** If a cross-session call hinges on data that should be in `segments.json` but isn't, escalate to tier 2 — don't reconstruct from JSONL.
- **Cross-session repetition outranks novelty.** A small-scope recommendation that fires in 5 transcripts often beats a clever one-off recommendation that fires in 1.
