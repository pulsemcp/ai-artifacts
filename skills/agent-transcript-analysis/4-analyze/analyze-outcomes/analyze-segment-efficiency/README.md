# `analyze-segment-efficiency`

The per-Segment "where did the time / tokens go?" analyzer.

## How it plugs in

Upstream: `3-orchestrate/analyze-agent-transcript` runs this on every Segment, not just Failures.
Downstream: findings that point at a tooling fix flow into `analyze-skill-gaps` / `analyze-mcp-gaps`; findings about model choice currently flow into the Prompting bucket as advice on how to route work.

## Design decisions

- **Run it on Successes too.** A 30-minute Success on a Goal a human would have done in 5 minutes is the single most under-flagged failure mode. Limiting efficiency analysis to Failures would miss it.
- **Hindsight is fair game.** Detour identification specifically asks "knowing what we know now, could the agent have skipped this?" — that's exactly the cross-check the per-transcript report should make.
- **One human-counterfactual estimate per Segment, not per turn.** Keeping the unit aligned with the Segment makes the number meaningful and the math simple.
- **Model-tier suggestions need real evidence.** "Could have used a smaller model" is too easy to say and too lossy to act on. The analyzer demands a turn-level argument before emitting one.
