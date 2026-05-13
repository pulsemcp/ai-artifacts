---
name: analyze-skill-trigger-performance
description: >
  Within a transcript segment, identify Skills that triggered when they
  shouldn't have (false positives) and Skills that should have triggered
  but didn't (false negatives). Output recommendations to modify Skill
  descriptions, or to delete Skills that consistently misfire.
user-invocable: false
---

# Analyze Skill trigger performance

Per-segment analyzer. Focuses on the **`description` field** of Skills — what makes them fire and what makes them stay silent.

## Inputs

- `segment_messages`: the full segment
- `available_skills`: the list of Skills that were available in the session (and their descriptions). The system-reminder messages in the JSONL list them
- `philosophy_skills`: `references/philosophy-on-skills.md`

## Output

```json
{
  "false_positives": [
    {"skill": "...", "fired_at_turn": N, "why_wrong": "...", "recommendation": {"kind": "modify" | "delete", "details": "..."}}
  ],
  "false_negatives": [
    {"skill": "...", "should_have_fired_at_turn": N, "why_missed": "...", "recommendation": {"kind": "modify", "details": "tighten/loosen description as follows: ..."}}
  ]
}
```

## Sequencing checklist

- [ ] List Skill invocations in the segment (Skill tool calls). For each, ask: was this the right Skill at the right time? If not, it's a **false positive**
- [ ] Walk the segment looking for moments that match an available Skill's stated purpose but where the Skill did **not** fire. Those are **false negatives**
- [ ] For false positives, recommend:
  - **modify** — narrow the `description`'s scope (more SKIP/TRIGGER conditions, more concrete examples)
  - **delete** — only if the Skill is so consistently misfiring that the team philosophy says retire it
- [ ] For false negatives, recommend:
  - **modify** — broaden or sharpen the `description` so this kind of moment matches; cite the moment as a triggering example to add
- [ ] Cross-check every recommendation against `philosophy-on-skills.md`. If a recommendation conflicts with the philosophy, drop it or note the conflict explicitly

## Notes

- Distinguish "didn't trigger" (the harness didn't surface the Skill) from "triggered but the agent ignored it" — the second is an *action* problem and belongs to `analyze-skill-action-performance`.
- A correct trigger that produced a wrong outcome is **not** a false positive here. It's an action-performance issue.
