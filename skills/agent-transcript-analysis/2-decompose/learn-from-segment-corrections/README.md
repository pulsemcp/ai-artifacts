# `learn-from-segment-corrections`

The feedback half of the tier-2 review loop. Reads the human corrections captured by `review-transcript-segments` and proposes concrete improvements to `decompose-into-transcript-segments`.

## Why this exists

`review-transcript-segments` is worth running on its own — it gives you a human-blessed `segments.reviewed.json`. But the corrections it captures are also *training signal*: they are a precise record of where the AI decomposer's judgment diverged from a human's. This skill closes the loop — it turns that record into proposed edits to the skill that produced the bad draft, so the same correction doesn't have to be made again.

Review without this skill: a one-shot cleanup. Review with it: a decomposer that gets better every time it's used.

## Files

| File | Role |
|---|---|
| `SKILL.md` | The skill contract — an LLM-driven analysis skill (no server, no UI). |

It has no `main.py`: the work is reading correction logs and writing a proposal, which the agent does directly.

## Input → output

```
tmp_dir(s)/
  segments.reviewed.json   # read: review.log + per-Segment review.corrections
       │
       ▼
  segment-correction-learnings.md   # written: clustered patterns + proposed skill changes
```

The output is a **proposal for human review**, not an applied change. Editing `decompose-into-transcript-segments` is a normal code change that goes through the usual PR gate — this skill just does the analysis that makes that change obvious and well-motivated.

## The loop

```
decompose-into-transcript-segments   →  segments.json        (AI draft)
review-transcript-segments           →  segments.reviewed.json + correction log
learn-from-segment-corrections       →  proposed edits to decompose-into-transcript-segments
        └──────────────── close the loop ────────────────┘
```

## Design decisions

- **Propose, don't apply.** The same human-in-the-loop principle that makes `segments.json` a draft makes this skill's output a draft. A skill that silently rewrites another skill from a handful of corrections would be unreviewable.
- **Patterns, not anecdotes.** A single correction is noise; the same `before → after` across several transcripts is a heuristic. The skill is explicitly told to run on review *volume*, and to park one-offs and contradictions in "Open questions".
- **The `note` is the highest-signal field.** A `before`/`after` says *what* the human changed; the context note says *why*. The skill leans on notes to trace a correction back to the specific rule that misfired.
- **Stays in its lane.** Corrections that are really about agent behavior (missing Skills, missing MCP tools) get routed toward tier 4, not jammed into the decomposer. This skill only proposes changes to the *decomposition* logic.
