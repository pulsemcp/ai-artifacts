# `learn-from-report-corrections`

The feedback half of the tier-4 review loop. Reads the human corrections captured by `review-report` and **flags concrete improvement opportunities** for `synthesize-report` — it does not edit any skill.

## Why this exists

`review-report` is worth running on its own — it gives you a human-blessed `findings.report.reviewed.json`. But the corrections it captures are also *signal*: they are a precise record of where the synthesis's leap from findings to recommendations diverged from a human's judgment. This skill closes the loop — it turns that record into a clear, well-evidenced write-up of where `synthesize-report` is drifting, so a human can decide what to change.

Review without this skill: a one-shot cleanup. Review with it: a standing read on how well the synthesis step is doing.

## Files

| File | Role |
|---|---|
| `SKILL.md` | The skill contract — an LLM-driven analysis skill (no server, no UI). |
| `README.md` | This file. |

It has no `main.py`: the work is reading correction logs and writing a proposal, which the agent does directly. The correction-provenance contract it reads is the one `review-report` writes — defined in that skill's bundled `review.py`.

## Input → output

```
batch_dir(s)/
  findings.report.reviewed.json   # read: review.log + per-item review verdicts
       │
       ▼
  report-correction-learnings.md  # written: clustered patterns + flagged opportunities
```

Each `batch_dir` holds one batch's reviewed report. Run this skill over several of them — the more reviewed batch reports, the stronger the pattern signal.

The output is a **write-up of flagged opportunities for a human**, not an applied change. This skill never edits `synthesize-report` — the skill files it can see are a deployed copy, not the source of truth. It does the analysis that makes a change obvious and well-motivated; a human makes the change, at its source, through the usual PR gate.

## The loop

```
synthesize-report             →  findings.report.json             (AI draft)
review-report                 →  findings.report.reviewed.json + correction log
learn-from-report-corrections →  flagged opportunities for synthesize-report
        └────────────────── close the loop ──────────────────┘
```

## Design decisions

- **Flag, don't apply.** The same human-in-the-loop principle that makes `findings.report.json` a draft makes this skill's output a flag, not a fix. A skill that rewrote `synthesize-report` from a handful of corrections would be unreviewable — and the skill files it sees at runtime are a deployed copy anyway, not the source of truth.
- **Patterns, not anecdotes.** A single rejection is noise; the same rejection reason across several reports is a heuristic. The skill is explicitly told to run on review *volume*, and to park one-offs and contradictions in "Open questions".
- **The `note` is the highest-signal field.** A `before`/`after` or a bare `reject` says *what* the human changed; the context note says *why*. The skill leans on notes to name which synthesis behavior drifted.
- **One skill, many behaviors.** Every tier-4 correction traces back to one skill — `synthesize-report` — so the diagnostic question is not *which skill* (as it is for the tier-3 learner) but *which behavior*: over-reaching the findings, mis-routing into the wrong bucket, mis-calibrating priority, or a weak philosophy check.

## Mirrors the tier-2 and tier-3 loops

This skill is the tier-4 member of the `learn-from-*-corrections` family — `learn-from-segment-corrections` (tier 2), `learn-from-analysis-corrections` (tier 3), `learn-from-report-corrections` (tier 4). Same shape — read a structured correction log, cluster it, flag opportunities, never apply — each pointed at a different interpretive step. The three never overlap: a wrong Segment tree is tier 2's, a wrong finding drawn from a correct tree is tier 3's, and a wrong recommendation synthesized from correct findings is tier 4's.
