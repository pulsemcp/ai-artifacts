# Tier 2: `2-orchestrate`

The single-skill layer in the middle of the pipeline. Owns segmentation, fan-out to the per-domain analyzers, and aggregation of their findings into one report.

## Skills in this tier

- `analyze-agent-transcript/` — the orchestrator

## How this tier plugs into the rest

Tier 2 sits between Tier 1 (acquisition) and Tier 3 (per-domain analysis). It consumes Tier 1's tmp folder, drives each Tier 3 analyzer per segment, and emits the final consolidated report.

The orchestrator is the **supported entry point** for analysis. Per-domain analyzers from Tier 3 should not be invoked directly except when debugging.

## Design decisions

- **Only one skill in this tier, by design.** Multiple competing orchestrators would split the recommendation format and lose the consolidation benefit. If the orchestrator needs to be specialized, it should grow optional inputs, not get cloned.
- **Segments are the unit of analysis.** A segment maps to a single user goal — that's the granularity at which prompting / Skill / MCP recommendations actually attach to causes.
- **Philosophy docs gate the final report.** Recommendations that conflict with `references/philosophy-on-{skills,mcp}.md` are dropped or flagged before they leave Tier 2.
