# `analyze-prompts` bucket

The "human prompting" recommendation bucket. Three skills live here as siblings:

- `analyze-agent-transcript-user-prompt/` — the per-user-Trigger analyzer (runs on every Segment whose `trigger.source == "user"` — either `kind: New` or `kind: Correction`).
- `analyze-agent-transcript-prompt-ambition/` — runs only on Segments with `trigger.kind == "New" && trigger.source == "user"` (the case formerly known as Initial Prompts). Flags under-scoped prompts and deterministic-trigger candidates.
- `pull-together-agent-transcript-goal-context/` — helper invoked when the Goal isn't self-evident from the user message alone.

## How the skills interplay

`analyze-agent-transcript` invokes `analyze-agent-transcript-user-prompt` once per Segment with `trigger.source == "user"`. Whenever `trigger.kind == "New"`, the orchestrator also runs `analyze-agent-transcript-prompt-ambition`. If `analyze-agent-transcript-user-prompt` cannot confidently extract a Goal, it delegates to `pull-together-agent-transcript-goal-context`, which reaches into git / GitHub / other named systems to disambiguate — then `analyze-agent-transcript-user-prompt` continues.

The Trigger classification (kind + source) and the per-Segment Goal both come from `segments.json`. The analyzers in this bucket consume those classifications — they do not re-derive them.

Output feeds the "Prompting" line of the final report — what the user should have written differently, and which user-typed New Triggers should have been deterministic triggers instead. Agent-source Triggers do not feed this bucket; their analysis lives in `analyze-agent-transcript-failure-hypothesis` (for the Correction subset) and the Skills/MCP analyzers.

## Design decisions

- **Goal extraction is the linchpin.** Every later analyzer assumes the orchestrator knows what the Segment was *for*. If that's wrong, the rest of the analysis is wrong — which is why disambiguation is its own helper Skill rather than a vague step inside `analyze-agent-transcript-user-prompt`.
- **Two analyzers, two questions.** `analyze-agent-transcript-user-prompt` asks "did this user message close its loop" — applies to both `New` and `Correction` user-source Triggers. `analyze-agent-transcript-prompt-ambition` asks "was this user-typed New Trigger scoped right, and should a machine have fired it instead of a human" — applies only to user-source `New`. Splitting them lets each stay focused.
- **Flat sibling layout, not nested.** Per the Skills spec, a Skill folder owns everything underneath it. All three Skills live as siblings inside this grouping folder; the "is a helper of" relationship is documented in each Skill, not in the directory tree.
- **The helper is read-only.** `pull-together-agent-transcript-goal-context` must never modify external systems, even accidentally — no PR comments, no issue edits.
- **Stay in the prompting bucket.** This folder doesn't draft Skill or MCP artifacts; those belong to `../analyze-skills/` and `../analyze-mcp/`. Findings that should produce a tooling change set `recommendation_route` for the orchestrator to forward.
- **Philosophy doc is the tie-breaker.** Both analyzers cross-check the `philosophy-on-prompting` reference — the team's closed-loop stance (end-to-end definition of done, verification, observability) — before emitting a finding, the same way `../analyze-skills/` leans on `philosophy-on-skills` and `../analyze-mcp/` on `philosophy-on-mcp`. It's what makes "closed-loop" and "ambitious" mean something specific rather than a per-Segment hunch.
