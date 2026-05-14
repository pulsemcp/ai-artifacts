---
name: learn-from-segment-corrections
description: >
  Read the human corrections captured in one or more segments.reviewed.json
  files (produced by review-transcript-segments) and turn them into concrete,
  proposed improvements to the decompose-into-transcript-segments skill — so
  the decomposer makes the same mistake less often next time. Consumes the
  append-only correction log (field edits, splits, merges, context notes),
  clusters it into recurring patterns, and emits a proposal of specific
  heuristic / wording changes for human review. Use this skill after a few
  transcripts have been reviewed, or whenever you want to close the loop
  between human review and the draft generator. Optional sibling of
  review-transcript-segments.
user-invocable: true
---

# Learn from segment corrections

`review-transcript-segments` captures, in structured form, every place a human disagreed with the decomposer's draft. This skill is the **other half of that loop**: it reads those corrections and proposes how to change `decompose-into-transcript-segments` so the decomposer drifts toward what the human would have done.

Without this skill, review is a one-shot cleanup. With it, every review makes the next decomposition measurably better.

## Inputs

- One or more `tmp_dir`s, each containing a `segments.reviewed.json` (the output of `review-transcript-segments`). The more reviewed transcripts, the stronger the pattern signal — a single correction is an anecdote; the same correction across five transcripts is a heuristic.

## Outputs

- **`segment-correction-learnings.md`** — written to the first `tmp_dir` (or a path the caller specifies). A proposal, not an applied change. It contains:
  - **Correction patterns** — the corrections clustered by what they have in common (e.g. "the decomposer keeps marking agent-source pivots as `New` when the human reclassifies them `Correction`").
  - **Proposed skill changes** — for each pattern, a specific, quotable edit to `decompose-into-transcript-segments/SKILL.md` (usually its "Heuristics for labeling" section) or to the methodology in `references/open-transcripts/schemas/transcript-segment.md`. Each proposal cites the corrections that motivate it.
  - **Open questions** — corrections that don't generalize yet, or that conflict with each other, flagged for a human to weigh in.

Applying the proposal is a **separate, human-gated step** — this skill proposes; a human (or a follow-up edit) decides.

## Sequencing checklist

- [ ] Load every `segments.reviewed.json` and pull its `review.log` (the append-only correction log) plus the per-Segment `review.corrections` stamps
- [ ] Bucket each log entry by type — `field`, `split`, `merge`, `note` — and, for `field` edits, by the dotted `field` path (`trigger.kind`, `goal.kind`, `outcome.kind`, `meta.event_range.*`, …)
- [ ] **Cluster within buckets**: a `before → after` direction that repeats is a pattern. Read the attached `note` entries — they are the human's own explanation of *why* the draft was wrong, and are the highest-signal input
- [ ] For each cluster, **trace it back to a rule** in `decompose-into-transcript-segments/SKILL.md` or `transcript-segment.md` — which heuristic produced the wrong draft? Was a heuristic missing entirely?
- [ ] Draft a **specific, quotable change** to that rule. Vague advice ("be more careful about Triggers") is useless; "in 'Heuristics for labeling', add: a `UserMessage` that only adds a fact without changing the ask is *not* a Correction" is actionable
- [ ] Separate **generalizable** corrections from **one-offs** — a correction that fired once, or that contradicts another correction, goes in "Open questions", not "Proposed skill changes"
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
- Actually editing `decompose-into-transcript-segments` — this skill *proposes*; applying the proposal is a separate human-gated step (a normal code change, reviewed via PR).
- Cross-transcript *analysis* findings — that's tier 5. This skill is narrowly about improving the decomposer from its own review history.

## Notes

- This skill is **only as good as the review volume**. Run it after several transcripts have been through `review-transcript-segments`, not after one.
- Conflicting corrections are signal too: if one reviewer merges what another splits, the methodology itself is ambiguous — that belongs in "Open questions" and may warrant a `transcript-segment.md` clarification rather than a heuristic tweak.
