# `analyze-cross-transcript`

Tier 3's cross-cutting bucket. The other three artifact buckets and `analyze-outcomes` work *within* one transcript, per Segment; this bucket works *across* many transcripts' per-transcript `findings.*.json` sets. Per-transcript analysis catches issues inside a session — this bucket catches habits across sessions. It runs once, last in tier 3, over the whole batch — an optional pre-report augmentation.

## Skills in this bucket

- `analyze-cross-transcript-patterns/` — reads the tier-3 `findings.*.json` sets of N already-analyzed transcripts (the per-Segment analyzer outputs `analyze-agent-transcript` wrote for each) and surfaces hindsight-as-foresight Segment patterns, recurring user prompts, deduped cross-session Skill/MCP gaps, and time-spend patterns.

## Why it sits in tier 3

Tier 3 is **all the labeling** — turning transcripts and Segments into structured findings. Tier 4 is **all the synthesis** — turning findings into a recommended set of next steps. Cross-transcript pattern-finding is labeling: it produces findings, not the final recommendation slate. So it belongs in tier 3, even though its *scope* is many transcripts rather than one.

It is not driven by the per-transcript orchestrator (`analyze-agent-transcript`) the way the per-Segment buckets are — it runs once, last in tier 3, over a whole batch of already-analyzed transcripts' findings sets. The folder hierarchy is for humans; this bucket lives under `3-analyze/` because that is what kind of work it is, not because the orchestrator fans out to it per Segment.

## How this bucket plugs into the rest

Upstream: a batch of many transcripts' tier-3 findings sets — the `findings.{outcomes,prompts,skills,mcp}.json` `analyze-agent-transcript` produced for each transcript. There is no per-transcript report; this bucket reads the raw per-transcript findings to catch the long tail that only becomes significant in aggregate. It takes the list of per-transcript `tmp_dir`s that make up the batch, plus a `batch_dir` (the batch-level working directory).
Downstream: it writes `findings.cross-transcript.json` into `batch_dir`, where `synthesize-report` reads it in tier 4 — an optional pre-report augmentation alongside every transcript's `findings.*.json`. `synthesize-report` always synthesizes the whole batch's findings into one actionable recommendation slate.

## Design decisions

- **Pure aggregation, no re-walking.** This bucket reads only the structured outputs of per-transcript analysis — the `findings.*.json` sets (and the `segments.json` they were derived from), never raw JSONL. There is no per-transcript report to read; running cross-transcript analysis on raw findings is what catches the individually-minor findings that only matter once they recur. If something is missing from a `segments.json`, fix tier 2 and re-run the lower tiers; don't paper over it here.
- **Clusters require a minimum count.** Patterns flagged here must appear in at least two (often three) sessions. One-off findings belong in the per-transcript analysis.
- **Labeling, not synthesis.** This bucket produces findings — "this pattern recurs in N sessions." Turning those findings into a prioritized change list is `synthesize-report`'s job (tier 4), not this bucket's. It is still tier-3 labeling — it just runs once over the whole batch as a last, optional pre-report step rather than per transcript.
- **A different scope, intentionally.** The per-Segment buckets answer "how could this Segment have gone better"; this bucket answers "what pattern recurs across sessions." Same tier, different unit of analysis.
