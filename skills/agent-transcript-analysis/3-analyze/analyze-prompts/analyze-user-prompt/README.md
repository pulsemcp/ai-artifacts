# `analyze-user-prompt`

Per-user-Trigger analyzer: classify the message (question / delegation / mixed), confirm the Segment's Goal, judge whether the Segment closed the loop, and surface prompting issues.

## How it plugs in

Invoked once per Segment whose `trigger.source == "user"` (either `trigger.kind` value) by `analyze-agent-transcript`. Co-producer of the "Prompting" recommendation bucket alongside `../analyze-prompt-ambition/`.

If the Goal can't be confidently extracted from the user message and surrounding Segments, this skill delegates to its sibling `../pull-together-goal-context/`, which reaches into external systems for disambiguation, then this skill resumes with the refined Goal.

## Design decisions

- **Trust Tier 2's Trigger classification.** New vs Correction is decided by the segmenter; this skill consumes it, never re-derives it.
- **User-source Correction triggers are first-class evidence.** A user-source Correction at the next Segment's head means the prior Segment was a retro-Failure — surface that loudly even when the local Outcome is Success. Agent-source Corrections produce the same retro-Failure signal at a softer weight; `analyze-failure-hypothesis` handles that branch, this skill only sees user-source Triggers.
- **Stay in the prompting bucket.** Don't propose Skill or MCP artifacts here — set `recommendation_route` and let the orchestrator forward to `../../analyze-skills/` or `../../analyze-mcp/`.
- **Don't fabricate a Goal.** If the helper can't lift goal certainty above `low`, mark the finding tentative rather than guessing. The orchestrator handles tentative findings specially.
- **Ambition lives next door.** "Was this user-source New trigger scoped right?" / "Should a deterministic trigger have fired it?" belong to `../analyze-prompt-ambition/`, not here.
