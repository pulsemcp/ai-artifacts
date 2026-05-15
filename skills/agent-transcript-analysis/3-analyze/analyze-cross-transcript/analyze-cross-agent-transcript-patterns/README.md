# `analyze-cross-agent-transcript-patterns`

The labeling skill of phase 3's `analyze-cross-transcript` bucket. Operates on the per-transcript `findings.*.json` sets of many already-analyzed transcripts — the across-sessions counterpart to the per-Segment analyzers in the other phase-3 buckets.

## How it plugs in

Upstream: a batch of many transcripts' phase-3 findings sets — the `findings.{outcomes,prompts,skills,mcp}.json` that `analyze-agent-transcript`'s per-Segment analyzers produced for each transcript. There is no per-transcript report; this skill reads the raw per-transcript findings, which is what lets it catch the individually-minor findings that only become significant once they recur across sessions — exactly the long tail it exists to catch.
Downstream: it writes `findings.cross-transcript.json` into the `batch_dir`, where `synthesize-agent-transcript-analysis-report` reads it in phase 4 — an optional pre-report augmentation alongside every transcript's `findings.*.json`. This skill produces *findings* ("this pattern recurs in N sessions"); turning them into a prioritized change list is `synthesize-agent-transcript-analysis-report`'s job.

Unlike the per-Segment analyzers, it is not fanned out by the orchestrator. It runs **once, last in phase 3** — after every transcript in the batch has been analyzed — over the whole batch's findings sets, as an optional step before `synthesize-agent-transcript-analysis-report`.

## Design decisions

- **Findings in, no report in.** The unit of input is each transcript's per-transcript analysis output set — its `findings.*.json`. There is no per-transcript report; reading the raw findings is what surfaces the long tail of individually-minor findings that only matter in aggregate, which is the entire reason this skill exists.
- **Clustering, not enumeration.** Findings come from clusters of similar Segment-derived findings / Prompts. A single anomaly belongs in the per-transcript analysis, not here.
- **Hindsight ↔ foresight.** Every flagged pattern must come with a concrete change (Skill, CLAUDE.md, MCP, hook, or prompting habit) that would have let the team see the short path *up front*.
- **Trust the segment tree.** The `findings.*.json` items carry the Segment context they were derived from, and the per-transcript `segments.json` sits alongside them for fuller detail. If a cross-session call hinges on data that should be in `segments.json` but isn't, escalate to phase 2 — don't reconstruct from JSONL.
- **Cross-session repetition outranks novelty.** A small-scope finding that fires in 5 transcripts often beats a clever one-off finding that fires in 1.
- **Labeling, not synthesis.** It lives in phase 3 because it produces findings, not the final recommendation slate. Its *scope* is many transcripts; its *kind* of work is labeling. It just runs once over the whole batch — last in phase 3, an optional pre-report step — rather than per transcript.
