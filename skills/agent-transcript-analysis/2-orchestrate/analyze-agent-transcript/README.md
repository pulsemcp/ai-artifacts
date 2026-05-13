# `analyze-agent-transcript`

The orchestrator. Use this when you want a full analysis of a session — the entry point to the per-segment analyzers and the only skill that emits an aggregated, consolidated report.

## How it plugs in

Upstream: consumes the tmp folder produced by `get-one-claude-code-transcript`.
Downstream: drives the per-segment analyzers in order — `analyze-user-prompt`, then the three `analyze-skill-*` analyzers, then the three `analyze-mcp-*` analyzers — and aggregates their findings.

Other skills should not be invoked individually unless you're explicitly debugging one of them. The orchestrator is the supported entry point for analysis.

## Design decisions

- **Segment by user goal, not by turn count.** A "goal-aligned segment" is the natural unit of analysis because that's the granularity at which a Skill or prompting fix would have helped.
- **Fan out per segment, dedupe per session.** Each segment gets its own pass through the analyzers; recommendations are deduped at the session level so the final report isn't repetitive.
- **Philosophy docs are mandatory cross-checks.** Recommendations that conflict with `philosophy-on-{skills,mcp}.md` are dropped or flagged before they reach the report.
- **Actionable or silent.** Segments that produce no real recommendation are reported as "no change needed" — we don't manufacture findings.
