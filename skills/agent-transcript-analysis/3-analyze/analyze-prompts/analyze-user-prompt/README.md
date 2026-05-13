# `analyze-user-prompt`

Per-segment analyzer for the user's prompt: classify it (question / delegation / mixed), extract the goal, judge whether the segment closed the loop, and surface prompting issues.

## How it plugs in

Invoked once per segment by `analyze-agent-transcript`. Sole producer of the "Prompting" recommendation bucket.

If the goal can't be confidently extracted from the prompt and surrounding turns, this skill delegates to its sibling `../pull-together-goal-context/`, which reaches into external systems for disambiguation, then this skill resumes with the refined goal.

## Design decisions

- **Stay in the prompting bucket.** Don't propose Skill or MCP changes here — that's what `../../analyze-skills/` and `../../analyze-mcp/` are for. A clean separation keeps the final report's buckets coherent.
- **Follow-up prompts are the strongest signal.** A session that was *meant* to be one-shot but received a corrective follow-up almost always indicates a prompting issue, a missing Skill, or a missing MCP — flag it loudly.
- **Don't fabricate a goal.** If the helper can't lift goal certainty above `low`, mark the segment "tentative" rather than guessing. The orchestrator handles tentative segments specially.
