# `review-report`

The human review checkpoint for phase 4. Opens a localhost UI to audit and correct the AI-synthesized recommendation slate, and writes a `findings.report.reviewed.json` sibling with full correction provenance.

## Why this exists

`synthesize-report` makes the pipeline's one **leap from analysis to recommendations** — once, over the whole batch. Phase 3 only labels; phase 4 decides what to *do* about the labels — and that decision can over-reach. A recommendation can claim more than its `sources` findings support, land in the wrong bucket, mis-prioritize, or contradict team philosophy. A confident-but-wrong recommendation is the one a human acts on and regrets.

So `findings.report.json` is treated as a **draft** — the same stance `review-transcript-segments` takes toward the Segment tree and `review-analysis` takes toward the phase-3 findings. This skill is where a human reviews the leap itself: for each recommendation, *does this actually follow from the findings it cites?* Their corrections are captured in a structured, replayable form so `synthesize-report` can be improved.

## Files

| File | Role |
|---|---|
| `main.py` | Thin wrapper. `--tmp-dir` (required — pass the `batch_dir`), `--port` (default 9853), `--no-browser`. Picks a directory, pins the `kind` to `report`, and calls `review_server.py`'s `serve()`. |
| `review_server.py` | The localhost HTTP server — loads a draft, serves the UI, handles save. |
| `review_ui.html` | The single static review UI, served by `review_server.py`. |
| `review.py` | The correction-provenance contract — load, validate, stamp, atomic-write. |
| `SKILL.md` | The skill contract. |

`review_server.py`, `review_ui.html`, and `review.py` are **byte-identical copies** of the engine `review-analysis` bundles. That engine was `kind`-parametrised and reserved `REPORT_KIND` from the start, precisely so phase 4's report would review with no new code. They are bundled (not imported from a sibling) because a skill running from a deployed `.claude/skills/` directory can't reach another skill's files — portability beats deduplication.

## The reviewed sibling

```
batch_dir/
  findings.report.json            # synthesize-report draft — never touched
  findings.report.reviewed.json   # written here; same schema + a `review` block
```

`findings.report.reviewed.json` is schema-compatible with the draft (readers consume either), with two additions:

- every item carries `review: {verdict, corrections}` — `verdict` is `approved` / `corrected` / `rejected` / `unreviewed`
- the document additionally carries `review: {reviewed_at, reviewer, base, log, warnings}` — file-level provenance plus the full append-only correction log

## Correction log entry types

Every action appends one replayable entry to the log:

- `{type: "approve", item_id, at}` — thumbs-up; the leap holds and the recommendation is worth acting on.
- `{type: "field", item_id, field, before, after, note, at}` — one field of a recommendation was corrected.
- `{type: "reject", item_id, note, at}` — the whole recommendation is wrong — usually the leap over-reaches its `sources`.
- `{type: "note", item_id, note, at}` — a free-text "why / context" note.

The per-item `verdict` is derived from the log: a reject beats a correction beats an approval.

## The phase-4 loop

```
synthesize-report             →  findings.report.json (AI draft)
review-report                 →  findings.report.reviewed.json + correction log
learn-from-report-corrections →  flagged opportunities for synthesize-report
        └────────────────── close the loop ──────────────────┘
```

## Design decisions

- **The draft is immutable; the review is a sibling.** Keeping `findings.report.json` pristine means the synthesis-vs-human diff is always inspectable, and a bad review can be thrown away by deleting one file. Same contract as `review-analysis` and `review-transcript-segments`.
- **One engine, every reviewable kind.** `findings.report.json` is the same `{kind, items}` envelope as a phase-3 findings file, so the server, UI, and provenance contract are reused unchanged — parametrised only by `kind`. `review-analysis` runs the engine with a phase-3 `kind`; this skill runs it with `report`. `REPORT_KIND` was reserved in `review.py` from the start for exactly this.
- **Self-contained, not DRY.** The three engine files are bundled copies, not a shared import. A skill that runs from a deployed `.claude/skills/` copy can't reach a sibling's files, so each carries its own.
- **Review the leap, not the labels.** Phase 3's review (`review-analysis`) checks whether a *finding* is true. This skill checks whether a *recommendation* follows from the findings it cites — a different question, which is why phase 4 gets its own checkpoint instead of folding into phase 3's.
- **Warnings never block a save.** The validator checks the envelope (a `kind`, an `items` list, unique ids) but the reviewer can always save anyway.
- **Trust upstream redaction.** Secret-redaction runs once at acquire time (phase 1). `findings.report.json` was synthesized from already-redacted findings, so the reviewed sibling is written as-is — no second redaction pass here.

## Mirrors the phase-2 and phase-3 review checkpoints

This skill is the phase-4 member of a family: `review-external-context` (phase 1), `review-transcript-segments` (phase 2), `review-analysis` (phase 3), `review-report` (phase 4). Every interpretive step in the pipeline gets a human checkpoint with the same contract — an immutable draft, a reviewed sibling, an append-only correction log, and a `learn-from-*-corrections` sibling that turns the log into flagged improvement opportunities.
