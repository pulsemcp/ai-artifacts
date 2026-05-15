# `learn-from-agent-transcript-analysis-corrections`

The feedback half of the phase-3 review loop. Reads the human corrections captured by `review-agent-transcript-analysis` and **flags concrete improvement opportunities** for the phase-3 analyzers — it does not edit any skill.

## Why this exists

`review-agent-transcript-analysis` is worth running on its own — it gives you a human-blessed `findings.<kind>.reviewed.json`. But the corrections it captures are also *signal*: they are a precise record of where an analyzer's judgment diverged from a human's. This skill closes the loop — it turns that record into a clear, well-evidenced write-up of where the analyzers are drifting, so a human can decide what to change.

Review without this skill: a one-shot cleanup. Review with it: a standing read on which phase-3 analyzers need work.

## Files

| File | Role |
|---|---|
| `SKILL.md` | The skill contract — an LLM-driven analysis skill (no server, no UI). |

It has no `main.py`: the work is reading correction logs and writing a proposal, which the agent does directly. The correction-provenance contract it reads is the one `review-agent-transcript-analysis` writes — defined in that skill's bundled `review.py`.

## Input → output

```
tmp_dir(s)/
  findings.<kind>.reviewed.json   # read: review.log + per-item review verdicts
       │
       ▼
  analysis-correction-learnings.md   # written: clustered patterns + flagged opportunities
```

The output is a **write-up of flagged opportunities for a human**, not an applied change. This skill never edits the phase-3 analyzers — the skill files it can see are a deployed copy, not the source of truth. It does the analysis that makes a change obvious and well-motivated; a human makes the change, at its source, through the usual PR gate.

## The loop

```
analyze-agent-transcript / analyze-cross-agent-transcript-patterns
                                  →  findings.<kind>.json            (AI draft)
review-agent-transcript-analysis                   →  findings.<kind>.reviewed.json + correction log
learn-from-agent-transcript-analysis-corrections   →  flagged opportunities for the phase-3 analyzers
        └────────────────── close the loop ──────────────────┘
```

## Design decisions

- **Flag, don't apply.** The same human-in-the-loop principle that makes `findings.<kind>.json` a draft makes this skill's output a flag, not a fix. A skill that rewrote another skill from a handful of corrections would be unreviewable — and the skill files it sees at runtime are a deployed copy anyway, not the source of truth.
- **Patterns, not anecdotes.** A single rejection is noise; the same rejection reason across several transcripts is a heuristic. The skill is explicitly told to run on review *volume*, and to park one-offs and contradictions in "Open questions".
- **The `note` is the highest-signal field.** A `before`/`after` or a bare `reject` says *what* the human changed; the context note says *why*. The skill leans on notes to trace a correction back to the analyzer that misfired.
- **Stays in its lane.** A correction on a `skills` finding is attributed to the `analyze-skill-*` analyzers, a `prompts` correction to the `analyze-prompt-*` analyzers, and so on — never cross-attributed. This skill only flags opportunities in the *phase-3 analyzers*; decomposer corrections are `learn-from-agent-transcript-segment-corrections`'s job.

## Mirrors the phase-2 loop

This skill is the phase-3 twin of `learn-from-agent-transcript-segment-corrections`. Same shape — read a structured correction log, cluster it, flag opportunities, never apply — pointed at the phase-3 analyzers instead of the decomposer. The two never overlap: phase-2 corrections are about *where the Segment tree was wrong*, phase-3 corrections are about *where a conclusion drawn from that tree was wrong*.
