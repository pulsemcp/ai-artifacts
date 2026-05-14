# `analyze-cross-transcript`

Tier 3's cross-cutting bucket. The other three artifact buckets and `analyze-outcomes` work *within* one transcript, per Segment; this bucket works *across* many transcripts' consolidated reports. Single-transcript analysis catches issues inside a session — this bucket catches habits across sessions.

## Skills in this bucket

- `analyze-cross-transcript-patterns/` — reads N consolidated reports from `analyze-agent-transcript` and surfaces hindsight-as-foresight Segment patterns, recurring user prompts, deduped cross-session Skill/MCP gaps, and time-spend patterns.

## Why it sits in tier 3

Tier 3 is **all the labeling** — turning transcripts and Segments into structured findings. Tier 4 is **all the synthesis** — turning findings into a recommended set of next steps. Cross-transcript pattern-finding is labeling: it produces findings, not the final recommendation slate. So it belongs in tier 3, even though its *scope* is many transcripts rather than one.

It is not driven by the per-transcript orchestrator (`analyze-agent-transcript`) the way the per-Segment buckets are — it is invoked directly with a batch of reports. The folder hierarchy is for humans; this bucket lives under `3-analyze/` because that is what kind of work it is, not because the orchestrator fans out to it per Segment.

## How this bucket plugs into the rest

Upstream: a batch of consolidated reports, each produced by `analyze-agent-transcript`.
Downstream: its `findings.cross-transcript.json` feeds `synthesize-report` in tier 4, the same as every other tier-3 bucket — `synthesize-report` can synthesize a single transcript's findings or a cross-transcript batch's findings into actionable next steps.

## Design decisions

- **Pure aggregation, no re-walking.** This bucket reads only the structured outputs of per-transcript analysis. If something is missing from a `segments.json`, fix tier 2 and re-run the lower tiers; don't paper over it here.
- **Clusters require a minimum count.** Patterns flagged here must appear in at least two (often three) sessions. One-off recommendations belong in the per-transcript report.
- **Labeling, not synthesis.** This bucket produces findings — "this pattern recurs in N sessions." Turning those findings into a prioritized change list is `synthesize-report`'s job (tier 4), not this bucket's.
- **A different scope, intentionally.** The per-Segment buckets answer "how could this Segment have gone better"; this bucket answers "what pattern recurs across sessions." Same tier, different unit of analysis.
