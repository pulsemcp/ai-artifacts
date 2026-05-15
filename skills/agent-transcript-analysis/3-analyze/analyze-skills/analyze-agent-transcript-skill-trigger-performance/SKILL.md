---
name: analyze-agent-transcript-skill-trigger-performance
description: >
  Within a Transcript Segment, identify Skills that triggered when they
  shouldn't have (false positives) and Skills that should have triggered
  but didn't (false negatives). Output recommendations to modify Skill
  descriptions, or to delete Skills that consistently misfire.
user-invocable: false
---

# Analyze Skill trigger performance

Per-Segment analyzer. Focuses on the **`description` field** of Skills — what makes them fire and what makes them stay silent.

## Inputs

- `segment`: a Segment from `segments.json` (Goal, Outcome, `meta.event_range`). The orchestrator hands you the Segment directly — you do not walk raw JSONL.
- `transcript.json`: the OpenTranscripts `Transcript` document. Dereference event ids from `segment.meta.event_range` into `transcript.json` `events[]` to find `ToolCall` events (`tool_name == "Skill"` for Skill invocations) and the moments where a Skill *should* have fired.
- `available_skills`: the list of Skills that were available in the session, with their descriptions. Recoverable from `transcript.json` — look for a `SystemEvent` whose `subtype == "attachment"` and whose `payload.attachment.type == "skill_listing"`; `payload.attachment.content` is the newline-delimited `- name: description` list. Best-effort, may be absent.
- `external_context` (optional): `external-context.json` if present.
- `philosophy_skills`: the `philosophy-on-skills` reference

## Output

This is the item **body**. The orchestrator wraps it with `id` / `segment_id` / `analyzer` (see the orchestrator's "Findings-item shape" section) — emit only the fields below.

```json
{
  "false_positives": [
    {"skill": "...", "fired_at_event": "<event id>", "why_wrong": "...", "recommendation": {"kind": "modify" | "delete", "details": "..."}}
  ],
  "false_negatives": [
    {"skill": "...", "should_have_fired_at_event": "<event id>", "why_missed": "...", "recommendation": {"kind": "modify", "details": "tighten/loosen description as follows: ..."}}
  ]
}
```

Evidence cites **OpenTranscripts event ids** (the `id` strings in `transcript.json`), never integer turn numbers. **When this Segment has no signal** — no false positives and no false negatives — return nothing; the orchestrator omits the item rather than writing one with empty arrays.

## Sequencing checklist

- [ ] List Skill invocations in the Segment's event range (`ToolCall` events with `tool_name == "Skill"`). For each, ask: was this the right Skill at the right time? If not, it's a **false positive**
- [ ] Walk the Segment's events looking for moments that match an available Skill's stated purpose but where the Skill did **not** fire. Those are **false negatives**
- [ ] For false positives, recommend:
  - **modify** — narrow the `description`'s scope (more SKIP/TRIGGER conditions, more concrete examples)
  - **delete** — only if the Skill is so consistently misfiring that the team philosophy says retire it
- [ ] For false negatives, recommend:
  - **modify** — broaden or sharpen the `description` so this kind of moment matches; cite the moment as a triggering example to add
- [ ] Cross-check every recommendation against the `philosophy-on-skills` reference. If a recommendation conflicts with the philosophy, drop it or note the conflict explicitly

## Notes

- Distinguish "didn't trigger" (the harness didn't surface the Skill) from "triggered but the agent ignored it" — the second is an *action* problem and belongs to `analyze-agent-transcript-skill-action-performance`.
- A correct trigger that produced a wrong outcome is **not** a false positive here. It's an action-performance issue.
