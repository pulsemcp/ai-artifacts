# `pull-together-goal-context`

Helper for `analyze-user-prompt`. Invoked only when the prompt's goal can't be confidently extracted from the prompt + surrounding turns alone.

## How it plugs in

Upstream: `analyze-user-prompt` calls this when its `goal_certainty` would otherwise be `low`.
Downstream: returns a refined goal + supporting evidence back to `analyze-user-prompt`, which then proceeds normally.

## Design decisions

- **Read-only, always.** Reaches into git, GitHub, and other named systems but must never write — no PR comments, no issue edits, no force-pushes. Easy mistakes here are publicly visible.
- **Stop early.** Pull the smallest amount of context that lifts goal certainty; do not bulk-fetch.
- **Delegate verbose pulls.** Long PR threads / large diffs go through a subagent so the analyzer's main context stays small.
- **Honest about ambiguity.** If the goal is still unclear after reasonable effort, return `goal_certainty: "low"` rather than fabricating a plausible-sounding goal.
