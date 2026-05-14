---
name: learn-from-segment-corrections
description: >
  Read the human corrections captured in one or more segments.reviewed.json
  files (produced by review-transcript-segments) and surface them as flagged
  improvement opportunities for the decomposition heuristics. Consumes the
  append-only correction log (field edits, splits, merges, context notes),
  clusters it into recurring patterns, diagnoses which heuristic misfired and
  in which direction, and writes that up for a human to act on. It flags
  opportunities — it does not edit any skill. Use this skill after a few
  transcripts have been reviewed, or whenever you want to close the loop
  between human review and the draft generator. Optional sibling of
  review-transcript-segments.
user-invocable: true
---

# Learn from segment corrections

`review-transcript-segments` captures, in structured form, every place a human disagreed with the decomposer's draft. This skill is the **other half of that loop**: it reads those corrections, finds the patterns in them, and **flags concrete improvement opportunities** for the `decompose-into-transcript-segments` heuristics — so a human knows exactly where the decomposer is drifting from what they'd have done.

It **flags opportunities; it does not apply them.** This skill never edits `decompose-into-transcript-segments` (or any other skill). The skill files visible at runtime are a deployed copy — their source of truth lives elsewhere — so the right move is always to *surface* the opportunity for a human, not to patch the copy in place.

Without this skill, review is a one-shot cleanup. With it, every review tells you something actionable about the draft generator.

## Inputs

- One or more `tmp_dir`s, each containing a `segments.reviewed.json` (the output of `review-transcript-segments`). The more reviewed transcripts, the stronger the pattern signal — a single correction is an anecdote; the same correction across five transcripts is a heuristic.

## Outputs

- **`segment-correction-learnings.md`** — written to the first `tmp_dir` (or a path the caller specifies). A write-up of flagged opportunities for a human, not an applied change. It contains:
  - **Correction patterns** — the corrections clustered by what they have in common (e.g. "the decomposer keeps marking agent-source pivots as `New` when the human reclassifies them `Correction`").
  - **Flagged opportunities** — for each pattern, which `decompose-into-transcript-segments` heuristic appears to be misfiring and **in which direction** (too aggressive / too conservative / missing entirely), with the corrections that motivate it cited as evidence. Describe the opportunity precisely enough that a human can act on it — but stop there: don't write a ready-to-paste edit, and don't point at skill files by path.
  - **Open questions** — corrections that don't generalize yet, or that conflict with each other, flagged for a human to weigh in.

This skill **flags; it does not apply.** Whoever picks up the write-up decides whether and how to change the decomposer, and makes that change at its source of truth through the normal PR gate.

## Sequencing checklist

- [ ] Load every `segments.reviewed.json` and pull its `review.log` (the append-only correction log) plus the per-Segment `review.corrections` stamps
- [ ] Bucket each log entry by type — `field`, `split`, `merge`, `note` — and, for `field` edits, by the dotted `field` path (`trigger.kind`, `goal.kind`, `outcome.kind`, `meta.event_range.*`, …)
- [ ] **Cluster within buckets**: a `before → after` direction that repeats is a pattern. Read the attached `note` entries — they are the human's own explanation of *why* the draft was wrong, and are the highest-signal input
- [ ] For each cluster, **trace it back to a heuristic** in `decompose-into-transcript-segments` (or to the segmentation methodology in the `transcript-segment` reference) — which heuristic produced the wrong draft? Was a heuristic missing entirely?
- [ ] Describe the opportunity **specifically and directionally**. Vague advice ("be more careful about Triggers") is useless; "the decomposer's Correction-vs-New heuristic is too broad — it's flagging `UserMessage`s that only add a fact without changing the ask" is actionable. Cite the corrections; don't write the patch
- [ ] Separate **generalizable** corrections from **one-offs** — a correction that fired once, or that contradicts another correction, goes in "Open questions", not "Flagged opportunities"
- [ ] Write `segment-correction-learnings.md` and print its path to stdout

## How to read the correction log

Each `segments.reviewed.json` carries `review.log` — a flat, time-ordered list. Entry shapes:

- `{type: "field", segment_id, field, before, after, note, at}` — the human changed one field. `field` is a dotted path. `before`/`after` are the values. `note` may be empty.
- `{type: "split", segment_id, result_ids, note, at}` — the human split a leaf into children. Signals the decomposer **under-segmented** (missed a Goal boundary).
- `{type: "merge", segment_ids, result_id, note, at}` — the human merged siblings. Signals the decomposer **over-segmented** — usually the more important signal, since over-segmentation is the decomposer's documented worst failure mode.
- `{type: "note", segment_id, note, at}` — a free-text "why / context" note. Always read these against the other entries on the same `segment_id`.

## Heuristics for clustering

- **Direction matters.** Ten `outcome.kind` edits split 9 `Success → Failure` and 1 the other way is a clear "the decomposer is too optimistic about Outcomes" pattern — don't dilute it by counting the lone reverse edit.
- **Splits and merges are about the leaf-stop rule and boundary triggers.** A pile of merges → the leaf-stop rule is too aggressive, or a boundary trigger is firing on noise. A pile of splits → a boundary trigger is too conservative.
- **`trigger.kind` corrections are the highest-value pattern.** Correction-vs-New drives the entire retro-Failure signal downstream; a systematic misclassification there poisons every tier-4 analyzer.
- **Notes that say "the agent should have…" are usually really Skill/MCP gaps**, not decomposer bugs — route those as Open questions toward tier 4, don't try to fix them in the decomposer.

## Out of scope

- Capturing corrections — that's `review-transcript-segments`.
- Editing `decompose-into-transcript-segments` or any other skill — this skill **flags opportunities for a human**; it never patches a skill. The deployed skill files are a copy; changes belong at the source of truth, behind the normal PR gate.
- Cross-transcript *analysis* findings — that's tier 5. This skill is narrowly about surfacing what the decomposer's own review history reveals.

## Notes

- This skill is **only as good as the review volume**. Run it after several transcripts have been through `review-transcript-segments`, not after one.
- Conflicting corrections are signal too: if one reviewer merges what another splits, the methodology itself is ambiguous — that belongs in "Open questions", and is worth flagging as a possible gap in the `transcript-segment` segmentation methodology rather than a decomposer heuristic.
