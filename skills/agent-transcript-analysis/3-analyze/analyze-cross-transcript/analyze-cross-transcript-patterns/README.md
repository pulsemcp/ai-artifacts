# `analyze-cross-transcript-patterns`

The labeling skill of tier 3's `analyze-cross-transcript` bucket. Operates on the per-transcript `findings.*.json` sets of many already-analyzed transcripts — the across-sessions counterpart to the per-Segment analyzers in the other tier-3 buckets.

## How it plugs in

Upstream: a batch of many transcripts' tier-3 findings sets — the `findings.{outcomes,prompts,skills,mcp}.json` that `analyze-agent-transcript`'s per-Segment analyzers produced for each transcript. **Not** the synthesized `report.md`: a single-transcript report is already filtered to what cleared that one session's report-worthiness bar, so running this skill on reports would miss the individually-minor findings that only become significant once they recur across sessions — exactly the long tail it exists to catch.
Downstream: its `findings.cross-transcript.json` feeds `synthesize-report` in tier 4 — the same as every other tier-3 bucket. This skill produces *findings* ("this pattern recurs in N sessions"); turning them into a prioritized change list is `synthesize-report`'s job.

Unlike the per-Segment analyzers, it is not fanned out by the orchestrator — it is invoked directly with a batch of many transcripts' findings sets.

## Design decisions

- **Findings in, not reports in.** The unit of input is each transcript's per-transcript analysis output set — its `findings.*.json` — never its synthesized `report.md`. A report is already filtered and synthesized; reading reports would drop the long tail of individually-minor findings that only matter in aggregate, which is the entire reason this skill exists.
- **Clustering, not enumeration.** Findings come from clusters of similar Segment-derived findings / Prompts. A single anomaly belongs in the per-transcript analysis, not here.
- **Hindsight ↔ foresight.** Every flagged pattern must come with a concrete change (Skill, CLAUDE.md, MCP, hook, or prompting habit) that would have let the team see the short path *up front*.
- **Trust the segment tree.** The `findings.*.json` items carry the Segment context they were derived from, and the per-transcript `segments.json` sits alongside them for fuller detail. If a cross-session call hinges on data that should be in `segments.json` but isn't, escalate to tier 2 — don't reconstruct from JSONL.
- **Cross-session repetition outranks novelty.** A small-scope finding that fires in 5 transcripts often beats a clever one-off finding that fires in 1.
- **Labeling, not synthesis.** It lives in tier 3 because it produces findings, not the final recommendation slate. Its *scope* is many transcripts; its *kind* of work is labeling.
