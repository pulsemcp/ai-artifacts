# `analyze-agent-transcript-prompt-ambition`

The "you split this into too many prompts" / "this should have been a deterministic trigger" analyzer.

## How it plugs in

Upstream: `3-analyze/analyze-agent-transcript` runs this once per Segment whose `trigger.kind == "New" && trigger.source == "user"` — the case formerly known as an Initial Prompt.
Downstream: `prompting_recommendation` flows into the Prompting bucket of the final report. `deterministic_trigger_candidate` findings are also visible to `analyze-agent-transcript-mcp-gaps` when the trigger implies an MCP server (e.g. listening to GitHub events).

## Design decisions

- **Two findings, one skill.** Under-ambition and deterministic-trigger candidacy share the same input (a user-source New Trigger) and the same evidence (Segment wall-clock + manifest). Splitting them into two skills would duplicate the read of `segments.json`.
- **North-star reminder lives here.** The team's stated end-state — that user-typed New Triggers move toward event-triggered invocation — is operationalized by this skill's `deterministic_trigger_candidate` field. Without it, the north star would be folklore.
- **Wall-clock thresholds are heuristics, not hard rules.** "Short" and "soon after" are intentionally fuzzy; the analyzer documents the numbers it observed so the human reviewer can recalibrate.
- **Stays in the prompting bucket.** Findings don't propose Skill or MCP artifacts directly; they hand seeds to the gap analyzers via the orchestrator.
