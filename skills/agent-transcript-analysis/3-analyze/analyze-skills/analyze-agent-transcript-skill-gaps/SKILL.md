---
name: analyze-agent-transcript-skill-gaps
description: >
  Within a Transcript Segment, identify Skills that don't exist yet but
  should — moments where a well-placed Skill would have saved turns or
  prevented a wrong turn. Outputs proposals for new Skills (name,
  description, body sketch) anchored to the philosophy doc. Often seeded
  by analyze-agent-transcript-failure-hypothesis when a Segment's root-cause class is
  missing_skill or non_triggering_skill.
user-invocable: false
---

# Analyze Skill gaps

Per-Segment analyzer. The "what's missing" analyzer for the Skill portfolio. Companion to `analyze-agent-transcript-skill-trigger-performance` (which works on Skills that *do* exist).

## Inputs

- `segment`: a Segment from `segments.json` (Goal, Outcome, `meta.event_range`). The orchestrator hands you the Segment directly — you do not walk raw JSONL.
- `transcript.json`: the OpenTranscripts `Transcript` document. Dereference event ids from `segment.meta.event_range` into `transcript.json` `events[]` for the turn-level evidence behind a gap.
- `available_skills`: list of Skills that were available, so we don't re-propose existing ones. Recoverable from `transcript.json` — look for a `SystemEvent` whose `subtype == "attachment"` and whose `payload.attachment.type == "skill_listing"`; `payload.attachment.content` is the newline-delimited list. Best-effort, may be absent.
- `failure_hypothesis_seed` (optional): the `recommendation_seed` from `analyze-agent-transcript-failure-hypothesis` for this Segment, if its `recommendation_route` was `skills` or `multi`
- `external_context` (optional): `external-context.json` if present.
- `philosophy_skills`: the `philosophy-on-skills` reference

## Output

This is the item **body**. The orchestrator wraps it with `id` / `segment_id` / `analyzer` (see the orchestrator's "Findings-item shape" section) — emit only the fields below.

```json
{
  "proposals": [
    {
      "name": "<kebab-case-skill-name>",
      "rationale": "<which heuristic this addresses (mistake-despite-correct-prompt, repeated long prompt, repeated work segment, wheel-spinning, foreseeable closed-loop limitation)>",
      "evidence_events": ["<event id>", "<event id>"],
      "description_sketch": "<what would go in the SKILL.md frontmatter description>",
      "body_sketch": "<bullet outline of the steps this Skill would prescribe>",
      "alternative": "<could this also be a CLAUDE.md instruction, hook, or MCP tool? — see philosophy doc>"
    }
  ]
}
```

`evidence_events` cites **OpenTranscripts event ids** (the `id` strings in `transcript.json`), never integer turn numbers. **When this Segment has no gap to propose**, return nothing; the orchestrator omits the item rather than writing one with an empty `proposals` array.

## Sequencing checklist

- [ ] If a `failure_hypothesis_seed` was passed, promote it first — flesh out the proposal with a description, body sketch, and alternative. Then continue scanning for additional gaps the seed didn't cover. **But first check the defer rule below** — if the seed points at a defect in a Skill that already fired, do not promote it into a new-Skill proposal
- [ ] Walk the Segment's events (dereferenced from `meta.event_range`) looking for the team's heuristics:
  - A multi-turn detour where the agent figured out something procedural (e.g. how to start the dev server, how to find the right config file) — candidate for a Skill that captures the answer
  - The user wrote (or would have had to write) a long context-establishing prompt — candidate for a Skill that injects that context
  - The agent went off-track from a moment that, in hindsight, a well-known guardrail Skill could have caught — candidate for a Skill at that decision point
  - The agent spent significant tokens or turns on something a human would have done in seconds — candidate for an automation Skill
- [ ] For each candidate, draft a proposal: name, description, body outline
- [ ] Cross-check the philosophy doc — *is* a Skill the right answer here, or would a CLAUDE.md instruction / hook / new MCP server be better? Note the alternative explicitly
- [ ] Suppress any proposal whose name or scope already matches an existing Skill in `available_skills` — that case belongs to `analyze-agent-transcript-skill-trigger-performance` or `analyze-agent-transcript-skill-action-performance` instead

## Notes

- Be opinionated about scope. A proposal like "be smarter about X" isn't actionable. A proposal with a concrete `description` and a 5-line body sketch is.
- It's fine to produce zero proposals for a clean Segment — return nothing and the orchestrator omits the item.
- **Defer to the action analyzers — don't double-count a fix.** When an existing Skill *fired* in this Segment and the right fix is to that Skill's body or shape, the canonical finding is a `modify` from `analyze-agent-transcript-skill-action-performance`. Do **not** also propose a new Skill for the same defect, even if a failure-hypothesis seed routed here. If the seed clearly targets an existing-Skill body defect, record the deferral (a one-line note that the fix belongs in the action `modify`) instead of proposing — `synthesize-agent-transcript-analysis-report` reconciles. Propose a new Skill only when *no* existing Skill covers the moment. The mirror of this rule lives in `analyze-agent-transcript-mcp-gaps`.
- **A seed that implies a hook / CI-check has a home here.** A failure-hypothesis `recommendation_seed` can point at a hook or a CI-check rather than a Skill or MCP tool. When the `recommendation_route` selects this gap analyzer, carry that hook/CI-check intent in the proposal's `alternative` field (state plainly "the better fix may be a hook / CI-check, not a Skill") so it is surfaced for `synthesize-agent-transcript-analysis-report` rather than dropped. Don't discard a seed just because it isn't strictly a Skill.
