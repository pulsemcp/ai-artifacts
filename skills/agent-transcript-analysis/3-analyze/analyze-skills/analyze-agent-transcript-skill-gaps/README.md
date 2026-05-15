# `analyze-agent-transcript-skill-gaps`

Per-segment analyzer focused on **Skills that should exist but don't**. The "what's missing" half of the Skills bucket.

## How it plugs in

Invoked once per segment by `analyze-agent-transcript`. Companion to `analyze-agent-transcript-skill-trigger-performance` and `analyze-agent-transcript-skill-action-performance`, which both work on Skills that *do* exist.

Output is a list of new-Skill proposals — each with a kebab-case name, a draft `description`, a short body sketch, and the heuristic it addresses.

## Design decisions

- **Concrete or nothing.** Vague "be smarter about X" proposals are dropped. A proposal must be specific enough that someone could open a PR from it.
- **Alternatives matter.** Every proposal must consider whether the right answer is actually a CLAUDE.md note, a hook, or an MCP tool instead. The philosophy doc draws the lines.
- **Five heuristics, not vibes.** Proposals must cite one of: mistake-despite-correct-prompt, repeated long prompt, repeated work segment, wheel-spinning, foreseeable closed-loop limitation.
- **Don't re-propose.** Anything that matches an existing Skill in scope belongs to trigger-performance or action-performance, not here.
