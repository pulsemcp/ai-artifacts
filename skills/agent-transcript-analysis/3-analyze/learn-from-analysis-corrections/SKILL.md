---
name: learn-from-analysis-corrections
description: >
  Read the human corrections captured in one or more
  findings.<kind>.reviewed.json files (produced by review-analysis), cluster
  them into recurring patterns, and surface them as flagged improvement
  opportunities for the phase-3 analyzers that drafted the findings. Consumes
  the append-only correction log (approvals, field edits, rejections, notes),
  diagnoses which analyzer misfired and in which direction, and writes that up
  for a human to act on. It flags opportunities — it does not edit any skill.
  Use after a few transcripts have been reviewed, or whenever you want to close
  the loop between human review and the analyzers. Optional sibling of
  review-analysis.
user-invocable: true
---

# Learn from analysis corrections

`review-analysis` captures, in structured form, every place a human disagreed with a phase-3 analyzer's findings. This skill is the **other half of that loop**: it reads those corrections, finds the patterns in them, and **flags concrete improvement opportunities** for the analyzer that drafted them — so a human knows exactly where an analyzer is drifting from what they'd have concluded.

It **flags opportunities; it does not apply them.** This skill never edits the phase-3 analyzers (or any other skill). The skill files visible at runtime are a deployed copy — their source of truth lives elsewhere — so the right move is always to *surface* the opportunity for a human, not to patch the copy in place.

Without this skill, review is a one-shot cleanup. With it, every review tells you something actionable about the analyzers.

## Inputs

- One or more `tmp_dir`s, each containing one or more `findings.<kind>.reviewed.json` files (the output of `review-analysis`). The more reviewed transcripts and buckets, the stronger the pattern signal — a single rejection is an anecdote; the same rejection across five transcripts is a heuristic.

## Outputs

- **`analysis-correction-learnings.md`** — written to the first `tmp_dir` (or a path the caller specifies). A write-up of flagged opportunities for a human, not an applied change. It contains:
  - **Correction patterns** — corrections clustered by what they have in common, grouped by the bucket and analyzer they trace back to (e.g. "across N transcripts the reviewer keeps rejecting `analyze-skill-gaps` findings that propose a Skill for a one-off task").
  - **Flagged opportunities** — for each pattern, which phase-3 analyzer appears to be misfiring and **in which direction** (too aggressive / too conservative / wrong rationale), with the corrections that motivate it cited as evidence. Describe the opportunity precisely enough that a human can act on it — but stop there: don't write a ready-to-paste edit, and don't point at skill files by path.
  - **Open questions** — corrections that don't generalize yet, or that conflict with each other, flagged for a human to weigh in.

This skill **flags; it does not apply.** Whoever picks up the write-up decides whether and how to change an analyzer, and makes that change at its source of truth through the normal PR gate.

## Sequencing checklist

- [ ] Find every `findings.<kind>.reviewed.json` across the given `tmp_dir`s and load each one's `review.log` (the append-only correction log) plus the per-item `review` verdicts
- [ ] Bucket each log entry by `kind` (`outcomes` / `prompts` / `skills` / `mcp` / `cross-transcript`) and by type (`approve` / `field` / `reject` / `note`)
- [ ] **Cluster within buckets**: a `reject` reason that repeats, or a `field` edit with a `before → after` direction that repeats, is a pattern. Read the `note` entries — they are the reviewer's own explanation of *why* the finding was wrong, and are the highest-signal input
- [ ] For each cluster, **trace it back to the analyzer** that produces that `kind` of finding:
  - `outcomes` → `analyze-failure-hypothesis`, `analyze-segment-efficiency`
  - `prompts` → `analyze-user-prompt`, `analyze-prompt-ambition`
  - `skills` → `analyze-skill-trigger-performance`, `analyze-skill-action-performance`, `analyze-skill-gaps`
  - `mcp` → `analyze-mcp-trigger-performance`, `analyze-mcp-action-performance`, `analyze-mcp-gaps`
  - `cross-transcript` → `analyze-cross-transcript-patterns`
- [ ] Describe the opportunity **specifically and directionally**. Vague advice ("be more careful about Skill gaps") is useless; "`analyze-skill-gaps` is proposing Skills for tasks that only appear once in the transcript — its bar for 'recurring enough to warrant a Skill' is too low" is actionable. Cite the corrections; don't write the patch
- [ ] Separate **generalizable** corrections from **one-offs** — a correction that fired once, or that contradicts another correction, goes in "Open questions", not "Flagged opportunities"
- [ ] Write `analysis-correction-learnings.md` and print its path to stdout

## How to read the correction log

Each `findings.<kind>.reviewed.json` carries `review.log` — a flat, time-ordered list. Entry shapes:

- `{type: "approve", item_id, at}` — the reviewer agreed with the finding. A high approval rate for a bucket is signal too: that analyzer is doing well.
- `{type: "field", item_id, field, before, after, note, at}` — the reviewer corrected one field. `before`/`after` are the values; `note` may be empty.
- `{type: "reject", item_id, note, at}` — the reviewer threw the whole finding out. The strongest negative signal; the `note` usually says why.
- `{type: "note", item_id, note, at}` — a free-text "why / context" note. Always read these against the other entries on the same `item_id`.

## Heuristics for clustering

- **Rejections are the loudest signal.** A pile of rejections in one bucket means that analyzer is firing on things that aren't real — too aggressive.
- **Field edits point at rationale, not existence.** The finding was worth keeping; the analyzer just got a detail wrong. A repeated `before → after` direction on the same field is a precise, fixable miss.
- **Direction matters.** Don't dilute a clear pattern by counting the lone reverse correction — note it as an Open question instead.
- **Approvals scope the problem.** An analyzer with 90% approvals and one recurring rejection pattern needs a narrow fix, not a redesign.
- **Stay in the analyzer's lane.** A correction on a `skills` finding is about the `analyze-skill-*` trio; a correction on a `prompts` finding is about `analyze-user-prompt` / `analyze-prompt-ambition`. Don't attribute an `mcp` rejection to the prompt analyzers.

## Out of scope

- Capturing corrections — that's `review-analysis`.
- Editing the phase-3 analyzers or any other skill — this skill **flags opportunities for a human**; it never patches a skill. The deployed skill files are a copy; changes belong at the source of truth, behind the normal PR gate.
- Decomposer corrections — that's `learn-from-segment-corrections`, the phase-2 counterpart. This skill is narrowly about what the phase-3 analyzers' review history reveals.

## Notes

- This skill is **only as good as the review volume**. Run it after several transcripts and buckets have been through `review-analysis`, not after one.
- Conflicting corrections are signal too: if one reviewer rejects what another approves, the finding type itself may be ambiguous — that belongs in "Open questions", and is worth flagging as a possible gap in the analyzer's own contract rather than a tuning issue.
