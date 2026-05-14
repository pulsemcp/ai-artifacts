# Tier 3: `3-orchestrate`

The single-skill layer in the middle of the pipeline. Owns fan-out to the per-Segment analyzers and the handoff to tier 5 for synthesis — it sequences the other tiers, it does not do their work.

## Skills in this tier

- `analyze-agent-transcript/` — the orchestrator.

## How this tier plugs into the rest

Tier 3 sits between Tier 2 (`decompose-agent-transcript-into-transcript-segments`) and Tier 5 (`synthesize-report`). It consumes `segments.json` (and `flamegraph.html`) from Tier 2, drives each Tier 4 analyzer per Segment, writes the `findings.{outcomes,prompts,skills,mcp}.json` set, then invokes `synthesize-report` to turn those findings into the consolidated `report.md` (and the reviewable `findings.report.json`). Downstream of tier 5, `analyze-cross-transcript-patterns` aggregates many transcripts' reports.

The orchestrator is the **supported entry point** for analysis. Per-domain analyzers from Tier 4 should not be invoked directly except when debugging. Tier 2's decomposer and Tier 5's `synthesize-report` are invoked by the orchestrator, not by the user — except when running `synthesize-report` on a cross-transcript batch.

## Design decisions

- **Only one skill in this tier, by design.** Multiple competing orchestrators would split the pipeline's shape and lose the single-entry-point benefit. If the orchestrator needs to be specialized, it should grow optional inputs, not get cloned.
- **The Segment, not the message, is the unit of analysis.** This tier never re-walks raw JSONL — it consumes the structured Segment tree from Tier 2.
- **Drive, don't synthesize.** The orchestrator fans out to four Tier-4 buckets (`analyze-outcomes`, `analyze-prompts`, `analyze-skills`, `analyze-mcp`) and writes their findings — but the aggregation, dedup, philosophy cross-check, and the three-bucket recommendation slate (Prompting / Skills / MCP) are `synthesize-report`'s job, in Tier 5. Synthesis got its own tier so the leap from findings to recommendations is reviewable on its own; the orchestrator's responsibility ends at well-formed `findings.<kind>.json`.
- **Tier 3 hands off; tier 5 finishes.** A full single-session run ends with `synthesize-report` invoked as the orchestrator's last step — so the supported entry point still produces a complete `report.md`, even though the synthesis itself lives one tier down.
