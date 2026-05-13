# Tier 5: `5-cross-transcript`

Cross-cutting analysis layer. Single-transcript analysis (tiers 1-4) catches issues *within* a session; this tier catches habits *across* sessions.

## Skills in this tier

- `analyze-cross-transcript-patterns/` — looks at N already-analyzed transcripts and surfaces hindsight-as-foresight Segment patterns, recurring user prompts, deduped cross-session Skill/MCP gaps, and time-spend patterns.

## How this tier plugs into the rest

Consumes the consolidated reports produced by `3-orchestrate/analyze-agent-transcript` for many sessions. Re-derives nothing from raw JSONL.

## Design decisions

- **Pure aggregation, no re-walking.** This tier reads only the structured outputs of the per-transcript analysis. If something's missing from a `segments.json`, fix tier 2 and re-run the lower tiers; don't paper over it here.
- **Clusters require a minimum count.** Patterns flagged here must appear in at least two (often three) sessions. One-off recommendations belong in the per-transcript report.
- **Aggregate recommendations earn extra rationale.** A cross-cutting recommendation should justify why the cross-session view changes the call vs. the per-session reports.
- **It's a different output shape, intentionally.** The per-transcript report answers "how could this session have gone better"; this tier answers "what habit should the team change."
