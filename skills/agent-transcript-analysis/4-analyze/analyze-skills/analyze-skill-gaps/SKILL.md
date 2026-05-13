---
name: analyze-skill-gaps
description: >
  Within a Transcript Segment, identify Skills that don't exist yet but
  should — moments where a well-placed Skill would have saved turns or
  prevented a wrong turn. Outputs proposals for new Skills (name,
  description, body sketch) anchored to the philosophy doc. Often seeded
  by analyze-failure-hypothesis when a Segment's root-cause class is
  missing_skill or non_triggering_skill.
user-invocable: false
---

# Analyze Skill gaps

Per-Segment analyzer. The "what's missing" analyzer for the Skill portfolio. Companion to `analyze-skill-trigger-performance` (which works on Skills that *do* exist).

## Inputs

- `segment`: a Segment from `segments.json` (Goal, Outcome, turn_range)
- `segment_turns`: the raw turns within `segment.meta.turn_range` from `main.jsonl`
- `available_skills`: list of Skills that were available (so we don't re-propose existing ones)
- `failure_hypothesis_seed` (optional): the `recommendation_seed` from `analyze-failure-hypothesis` for this Segment, if its `recommendation_route` was `skills` or `multi`
- `philosophy_skills`: `references/philosophy-on-skills.md`

## Output

```json
{
  "proposals": [
    {
      "name": "<kebab-case-skill-name>",
      "rationale": "<which heuristic this addresses (mistake-despite-correct-prompt, repeated long prompt, repeated work segment, wheel-spinning, foreseeable closed-loop limitation)>",
      "evidence_turns": [N, M],
      "description_sketch": "<what would go in the SKILL.md frontmatter description>",
      "body_sketch": "<bullet outline of the steps this Skill would prescribe>",
      "alternative": "<could this also be a CLAUDE.md instruction, hook, or MCP tool? — see philosophy doc>"
    }
  ]
}
```

## Sequencing checklist

- [ ] If a `failure_hypothesis_seed` was passed, promote it first — flesh out the proposal with a description, body sketch, and alternative. Then continue scanning for additional gaps the seed didn't cover
- [ ] Walk `segment_turns` looking for the team's heuristics:
  - A multi-turn detour where the agent figured out something procedural (e.g. how to start the dev server, how to find the right config file) — candidate for a Skill that captures the answer
  - The user wrote (or would have had to write) a long context-establishing prompt — candidate for a Skill that injects that context
  - The agent went off-track from a moment that, in hindsight, a well-known guardrail Skill could have caught — candidate for a Skill at that decision point
  - The agent spent significant tokens or turns on something a human would have done in seconds — candidate for an automation Skill
- [ ] For each candidate, draft a proposal: name, description, body outline
- [ ] Cross-check the philosophy doc — *is* a Skill the right answer here, or would a CLAUDE.md instruction / hook / new MCP server be better? Note the alternative explicitly
- [ ] Suppress any proposal whose name or scope already matches an existing Skill in `available_skills` — that case belongs to `analyze-skill-trigger-performance` or `analyze-skill-action-performance` instead

## Notes

- Be opinionated about scope. A proposal like "be smarter about X" isn't actionable. A proposal with a concrete `description` and a 5-line body sketch is.
- It's fine to produce zero proposals for a clean Segment.
