# Tier 3: `3-orchestrate`

The single-skill layer in the middle of the pipeline. Owns fan-out to the per-Segment analyzers and aggregation of their findings into one report.

## Skills in this tier

- `analyze-agent-transcript/` — the orchestrator.

## How this tier plugs into the rest

Tier 3 sits between Tier 2 (`2-decompose/decompose-into-transcript-segments`) and Tier 4 (per-domain analysis). It consumes `segments.json` (and `flamegraph.html`) from Tier 2, drives each Tier 4 analyzer per Segment, and emits the final consolidated report. Downstream of this tier, `5-cross-transcript/analyze-cross-transcript-patterns` aggregates many such reports.

The orchestrator is the **supported entry point** for analysis. Per-domain analyzers from Tier 4 should not be invoked directly except when debugging. Tier 2's decomposer is invoked by the orchestrator, not by the user.

## Design decisions

- **Only one skill in this tier, by design.** Multiple competing orchestrators would split the recommendation format and lose the consolidation benefit. If the orchestrator needs to be specialized, it should grow optional inputs, not get cloned.
- **The Segment, not the message, is the unit of analysis.** This tier never re-walks raw JSONL — it consumes the structured Segment tree from Tier 2.
- **Four buckets in, three buckets out.** The orchestrator drives four Tier-4 buckets (`analyze-outcomes`, `analyze-prompts`, `analyze-skills`, `analyze-mcp`) but emits three final-report buckets (Prompting / Skills / MCP). The outcomes bucket's findings get *routed* into the three output buckets — it doesn't get its own output column.
- **Philosophy docs gate the final report.** Recommendations that conflict with the `philosophy-on-skills` and `philosophy-on-mcp` references are dropped or flagged before they leave Tier 3.
