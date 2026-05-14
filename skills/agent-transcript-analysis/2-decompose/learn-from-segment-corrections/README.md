# `learn-from-segment-corrections`

The feedback half of the tier-2 review loop. Reads the human corrections captured by `review-transcript-segments` and **flags concrete improvement opportunities** for `decompose-into-transcript-segments` — it does not edit any skill.

## Why this exists

`review-transcript-segments` is worth running on its own — it gives you a human-blessed `segments.reviewed.json`. But the corrections it captures are also *signal*: they are a precise record of where the AI decomposer's judgment diverged from a human's. This skill closes the loop — it turns that record into a clear, well-evidenced write-up of where the decomposer is drifting, so a human can decide what to change.

Review without this skill: a one-shot cleanup. Review with it: a standing read on where the decomposer needs work.

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
  segment-correction-learnings.md   # written: clustered patterns + flagged opportunities
```

The output is a **write-up of flagged opportunities for a human**, not an applied change. This skill never edits `decompose-into-transcript-segments` — the skill files it can see are a deployed copy, not the source of truth. It does the analysis that makes a change obvious and well-motivated; a human makes the change, at its source, through the usual PR gate.

## The loop

```
decompose-into-transcript-segments   →  segments.json        (AI draft)
review-transcript-segments           →  segments.reviewed.json + correction log
learn-from-segment-corrections       →  flagged opportunities for decompose-into-transcript-segments
        └──────────────── close the loop ────────────────┘
```

## Design decisions

- **Flag, don't apply.** The same human-in-the-loop principle that makes `segments.json` a draft makes this skill's output a flag, not a fix. A skill that rewrote another skill from a handful of corrections would be unreviewable — and the skill files it sees at runtime are a deployed copy anyway, not the source of truth.
- **Patterns, not anecdotes.** A single correction is noise; the same `before → after` across several transcripts is a heuristic. The skill is explicitly told to run on review *volume*, and to park one-offs and contradictions in "Open questions".
- **The `note` is the highest-signal field.** A `before`/`after` says *what* the human changed; the context note says *why*. The skill leans on notes to trace a correction back to the specific heuristic that misfired.
- **Stays in its lane.** Corrections that are really about agent behavior (missing Skills, missing MCP tools) get routed toward tier 4, not attributed to the decomposer. This skill only flags opportunities in the *decomposition* logic.
