# `analyze-prompts` bucket

The "human prompting" recommendation bucket. Two skills live here as siblings:

- `analyze-user-prompt/` — the per-prompt analyzer
- `pull-together-goal-context/` — helper invoked when the prompt's goal isn't self-evident

## How the skills interplay

`analyze-agent-transcript` invokes `analyze-user-prompt` once per segment. If `analyze-user-prompt` cannot confidently extract a goal, it delegates to `pull-together-goal-context`, which reaches into git / GitHub / other named systems to disambiguate — then `analyze-user-prompt` continues with the refined goal.

Output feeds the "Prompting" line of the final report — what the user should have written differently.

## Design decisions

- **Goal extraction is the linchpin.** Every later analyzer assumes the orchestrator knows what the segment was *for*. If that's wrong, the rest of the analysis is wrong, which is why disambiguation is its own helper skill rather than a vague step inside `analyze-user-prompt`.
- **Flat sibling layout, not nested.** Even though `pull-together-goal-context` is logically downstream of `analyze-user-prompt`, both live as siblings inside this grouping folder. Per the Skills spec, a Skill folder owns everything underneath it — nesting one Skill's folder inside another's is ambiguous. The "is a helper of" relationship is documented in each skill, not in the directory tree.
- **The helper is read-only.** `pull-together-goal-context` must never modify external systems, even accidentally — no PR comments, no issue edits.
- **Stay in the prompting bucket.** This folder doesn't recommend Skill or MCP changes; those belong to `../analyze-skills/` and `../analyze-mcp/`.
