---
name: learn-from-report-corrections
description: >
  Read the human corrections captured in one or more
  findings.report.reviewed.json files (produced by review-report), cluster them
  into recurring patterns, and surface them as flagged improvement
  opportunities for synthesize-report — the skill that makes the leap from
  tier-4 findings to recommendations. Consumes the append-only correction log
  (approvals, field edits, rejections, notes), diagnoses where the synthesis
  over-reaches, mis-routes, or mis-prioritizes, and writes that up for a human
  to act on. It flags opportunities — it does not edit any skill. Use after a
  few reports have been reviewed. Optional sibling of review-report.
user-invocable: true
---

# Learn from report corrections

`review-report` captures, in structured form, every place a human disagreed with `synthesize-report`'s leap from findings to recommendations. This skill is the **other half of that loop**: it reads those corrections, finds the patterns in them, and **flags concrete improvement opportunities** for `synthesize-report` — so a human knows exactly where the synthesis is drifting from what they'd have recommended.

It **flags opportunities; it does not apply them.** This skill never edits `synthesize-report` (or any other skill). The skill files visible at runtime are a deployed copy — their source of truth lives elsewhere — so the right move is always to *surface* the opportunity for a human, not to patch the copy in place.

Without this skill, review is a one-shot cleanup. With it, every reviewed report tells you something actionable about the synthesis step.

## Inputs

- One or more `tmp_dir`s, each containing a `findings.report.reviewed.json` (the output of `review-report`). The more reviewed reports, the stronger the pattern signal — a single rejection is an anecdote; the same kind of rejection across five reports is a heuristic.

## Outputs

- **`report-correction-learnings.md`** — written to the first `tmp_dir` (or a path the caller specifies). A write-up of flagged opportunities for a human, not an applied change. It contains:
  - **Correction patterns** — corrections clustered by what they have in common (e.g. "across N reports the reviewer keeps rejecting `skills` recommendations whose `sources` don't actually support the proposed change", or "the reviewer keeps downgrading `priority` from high to medium").
  - **Flagged opportunities** — for each pattern, **how `synthesize-report` appears to be drifting** and **in which direction** (over-reaching the findings / mis-routing into the wrong bucket / over-prioritizing / weak `philosophy_check`), with the corrections that motivate it cited as evidence. Describe the opportunity precisely enough that a human can act on it — but stop there: don't write a ready-to-paste edit, and don't point at skill files by path.
  - **Open questions** — corrections that don't generalize yet, or that conflict with each other, flagged for a human to weigh in.

This skill **flags; it does not apply.** Whoever picks up the write-up decides whether and how to change `synthesize-report`, and makes that change at its source of truth through the normal PR gate.

## Sequencing checklist

- [ ] Find every `findings.report.reviewed.json` across the given `tmp_dir`s and load each one's `review.log` (the append-only correction log) plus the per-item `review` verdicts
- [ ] Bucket each log entry by recommendation `bucket` (`prompting` / `skills` / `mcp`) and by type (`approve` / `field` / `reject` / `note`)
- [ ] **Cluster the corrections.** A `reject` reason that repeats, or a `field` edit with a `before → after` direction that repeats, is a pattern. Read the `note` entries — they are the reviewer's own explanation of *why* the recommendation was wrong, and are the highest-signal input
- [ ] **Trace each cluster to a synthesis behavior.** Unlike the tier-4 learner, every correction here points back at one skill — `synthesize-report` — so the question is not *which* skill but *which behavior*:
  - rejections citing "the `sources` don't support this" → the synthesis is **over-reaching** the findings
  - corrections to `bucket` → the synthesis is **mis-routing** findings into the wrong output bucket
  - corrections to `priority` / `effort` → the synthesis is **mis-calibrating** how much each recommendation matters
  - rejections citing philosophy → the `philosophy_check` step is **too weak**
  - corrections that merge two recommendations into one (or split one) → the synthesis is **mis-clustering** the findings
- [ ] Describe the opportunity **specifically and directionally**. Vague advice ("be more careful") is useless; "`synthesize-report` is proposing `skills` recommendations from a single `analyze-skill-gaps` finding without checking whether the gap recurs — its bar for 'worth a recommendation' is too low" is actionable. Cite the corrections; don't write the patch
- [ ] Separate **generalizable** corrections from **one-offs** — a correction that fired once, or that contradicts another correction, goes in "Open questions", not "Flagged opportunities"
- [ ] Write `report-correction-learnings.md` and print its path to stdout

## How to read the correction log

Each `findings.report.reviewed.json` carries `review.log` — a flat, time-ordered list. Entry shapes:

- `{type: "approve", item_id, at}` — the reviewer agreed the leap holds. A high approval rate is signal too: the synthesis is doing well.
- `{type: "field", item_id, field, before, after, note, at}` — the reviewer corrected one field. `before`/`after` are the values; `note` may be empty. Watch `bucket` and `priority` edits especially — they point at routing and calibration drift.
- `{type: "reject", item_id, note, at}` — the reviewer threw the whole recommendation out. The strongest signal that the leap over-reached; the `note` usually says how.
- `{type: "note", item_id, note, at}` — a free-text "why / context" note. Always read these against the other entries on the same `item_id`.

## Heuristics for clustering

- **Rejections are the loudest signal.** A pile of rejections means the synthesis is recommending things the findings don't support — it is over-reaching.
- **`bucket` edits mean mis-routing.** If the reviewer keeps moving recommendations from one bucket to another, the synthesis is following `recommendation_route` wrong, or inventing cross-bucket recommendations.
- **`priority` edits mean mis-calibration.** A consistent down-grade direction means the synthesis inflates importance; a consistent up-grade means it under-sells.
- **Approvals scope the problem.** A synthesis with 90% approvals and one recurring rejection pattern needs a narrow fix, not a redesign.
- **One skill, many behaviors.** Every correction here is about `synthesize-report` — the diagnostic work is naming *which behavior* drifted, not *which skill*.

## Out of scope

- Capturing corrections — that's `review-report`.
- Editing `synthesize-report` or any other skill — this skill **flags opportunities for a human**; it never patches a skill. The deployed skill files are a copy; changes belong at the source of truth, behind the normal PR gate.
- Analyzer corrections (tier 4) and decomposer corrections (tier 2) — those are `learn-from-analysis-corrections` and `learn-from-segment-corrections`. This skill is narrowly about what the tier-5 *synthesis* review history reveals: a tier-4 finding being wrong is the analyzer's problem; a correct finding being turned into a bad recommendation is `synthesize-report`'s.

## Notes

- This skill is **only as good as the review volume**. Run it after several reports have been through `review-report`, not after one.
- Conflicting corrections are signal too: if one reviewer rejects a recommendation another approves, the synthesis may be making a genuinely ambiguous call — that belongs in "Open questions", and is worth flagging as a possible gap in `synthesize-report`'s own contract rather than a tuning issue.
- This skill is the tier-5 twin of `learn-from-analysis-corrections` (tier 4) and `learn-from-segment-corrections` (tier 2). Same shape — read a structured correction log, cluster it, flag opportunities, never apply — pointed at the synthesis step instead of the analyzers or the decomposer.
