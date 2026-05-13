# `analyze-skill-action-performance`

Per-segment analyzer focused on **Skill bodies that actually ran** — did the instructions help, hurt, or no-op?

## How it plugs in

Invoked once per segment by `analyze-agent-transcript`. Companion to `analyze-skill-trigger-performance` (the description) and `analyze-skill-gaps` (the missing).

For each Skill invocation in the segment, emits an outcome (helpful / neutral / hurtful), a rough cost estimate, and an optional modify/delete recommendation.

## Design decisions

- **Cost is a first-class concern.** A verbose Skill that's technically "helpful" but eats turns / tokens can still warrant a body trim.
- **Neutral is acceptable.** A Skill that ran without harming the segment and without obviously helping doesn't need a recommendation — produce `kind: "none"` and move on.
- **Body, not description.** "Wrong Skill fired" goes to trigger-performance. This analyzer assumes the right Skill ran and asks whether the body served it well.
- **Imperative tone matters.** If the agent ignored a correct Skill, the body usually needs a stronger MUST/SHALL directive rather than added content.
