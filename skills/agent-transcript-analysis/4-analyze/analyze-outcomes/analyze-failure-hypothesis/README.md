# `analyze-failure-hypothesis`

The Failure-Outcome analyzer.

## How it plugs in

Upstream: `3-orchestrate/analyze-agent-transcript` runs this for every Segment whose Outcome is Failure, plus every Segment whose next sibling opens with a Correction trigger (retro-Failure — either user-source or agent-source).
Downstream: the `recommendation_seed` is handed to the matching gap analyzer (`analyze-skill-gaps`, `analyze-mcp-gaps`) or to `analyze-user-prompt`, which fleshes it into a real proposal.

## Design decisions

- **Correction triggers are first-class failure signals.** Treating a corrective follow-up as a retro-Failure on the prior Segment is the single highest-leverage heuristic in this whole pipeline — overconfident assistant turns rarely admit failure on their own.
- **Both Correction sources count, but user-source is stronger.** A user-source Correction means the user had to intervene; agent-source Correction means the agent recovered on its own. Both produce a hypothesis; the user-source variant deserves a more forceful one.
- **Hypothesis, not verdict.** The output is explicitly an *improvement hypothesis*. The human reviewer (or the orchestrator's aggregation step) decides whether to accept it.
- **No artifact drafting here.** This skill points at a bucket and writes a seed; the actual Skill-body / MCP-tool draft lives in the gap analyzers. Keeps responsibility narrow.
- **Default-blame the artifacts, not the user.** Per the `transcript-segment` reference, the default root cause for a Correction is missing or non-triggering Skill / MCP, not user error.
