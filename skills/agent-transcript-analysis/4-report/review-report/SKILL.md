---
name: review-report
description: >
  Open a local browser UI to audit and correct the AI-synthesized phase-4
  report — findings.report.json in the batch_dir, the single batch-final
  recommendation slate synthesize-report produces from the whole batch's
  phase-3 findings. The report is a draft: thumbs-up the recommendations you'd
  act on, correct the ones whose framing or priority is off, reject the ones
  whose leap from the findings doesn't hold. Saving writes
  findings.report.reviewed.json next to the draft (the draft is never
  overwritten) with full correction provenance. Use after synthesize-report
  and before learn-from-report-corrections. Optional but recommended human
  checkpoint for phase 4.
user-invocable: true
---

# Review report

`synthesize-report` makes the pipeline's one **leap from analysis to recommendations** — it reads the whole batch's phase-3 findings and synthesizes them into `findings.report.json`, a flat slate of actionable next steps. That leap is interpretive: a recommendation can over-reach what its findings actually support, mis-prioritize, mis-route a finding into the wrong bucket, or contradict team philosophy. The synthesis will get some of them wrong.

This skill puts the report in front of a human in an editable UI — one recommendation at a time, thumbs-up / correct / reject — and records every correction with enough provenance that `learn-from-report-corrections` can turn the fixes into flagged improvement opportunities for `synthesize-report`.

It is the **review checkpoint for phase 4**, the phase-4 counterpart to `review-transcript-segments` (phase 2) and `review-analysis` (phase 3). It is optional — `findings.report.json` stands on its own — but every correction captured here makes the next synthesis better. Crucially, this is where a human reviews **the leap itself**: does each recommendation actually follow from the findings in its `sources` list?

## Inputs

- `batch_dir` (required): the batch-level working directory containing `findings.report.json` (or an existing `findings.report.reviewed.json` to keep iterating), produced by `synthesize-report`.

## The report document

`findings.report.json` is the **same envelope as every phase-3 findings file** — the review subsystem is deliberately schema-agnostic about it:

```
{
  "kind": "report",
  "items": [
    { "id": "rec-001", "bucket": "...", "recommendation": "...", "sources": [...], ... },
    ...
  ]
}
```

The only guarantees the reviewer (and the bundled `review.py`) rely on: a `kind`, an `items` list, and a unique non-empty `id` on every item. The recommendation fields — `bucket`, `action`, `title`, `recommendation`, `rationale`, `sources`, `priority`, `effort`, `philosophy_check` — are `synthesize-report`'s business; the UI renders them generically.

## Outputs

One file written into `batch_dir`:

- **`findings.report.reviewed.json`** — the human-blessed recommendation slate. **Same schema as `findings.report.json`**, so every downstream reader consumes it transparently (the bundled `review.py` loader prefers the reviewed sibling). It adds:
  - a `review: {verdict, corrections}` block on every item — `verdict` is one of `approved` / `corrected` / `rejected` / `unreviewed`
  - a document-level `review: {reviewed_at, reviewer, base, log, warnings}` block carrying file-level provenance and the full append-only correction log

`findings.report.json` is **never modified** — the AI draft is preserved so the synthesis-vs-human diff stays inspectable.

## Invocation

```
python main.py --tmp-dir /path/to/batch-dir [--port 9853] [--no-browser]
```

`main.py` is a thin wrapper over the review engine bundled alongside it — it picks a directory (here, the `batch_dir`), pins the `kind` to `report`, and calls `review_server.py::serve()`. The server binds `127.0.0.1:<port>` (default `9853`) and serves `review_ui.html`. Pass `--no-browser` to skip the auto-open on remote / headless hosts. `review_server.py`, `review_ui.html`, and `review.py` are bundled self-contained copies in this skill folder — byte-identical to the engine `review-analysis` carries — so it runs from a deployed `.claude/skills/` directory with no shared import.

## Sequencing checklist

- [ ] Confirm `batch_dir` contains `findings.report.json` (or `findings.report.reviewed.json`); if not, run `synthesize-report` first
- [ ] Start the local UI (`python main.py --tmp-dir <batch_dir>`, default `localhost:9853`)
- [ ] The user audits each recommendation against its `sources`: does this recommendation actually follow from the phase-3 findings it cites? Is the `bucket` right? the `priority`? does `philosophy_check` hold up?
- [ ] For each recommendation the user **Approves** it (thumbs-up), **corrects** the fields that are wrong, or **Rejects** the whole recommendation — and can attach a "why / context" note explaining a rejection or a correction
- [ ] The user clicks **Save**, which writes `findings.report.reviewed.json` and surfaces any envelope warnings (warnings never block a save — the reviewer's judgment wins)
- [ ] Downstream skills prefer `findings.report.reviewed.json` when it exists (the bundled `review.py` loader does this automatically)

## What the user can do per recommendation

- **Approve** — thumbs-up; the leap holds and the recommendation is worth acting on.
- **Correct a field** — edit any scalar field in place (`priority`, `bucket`, `recommendation`, `rationale`, …); the change is applied to the saved document and logged with `before` / `after`.
- **Reject** — the recommendation doesn't hold — the leap over-reaches its `sources`, or it contradicts philosophy. It stays in the document, stamped `verdict: rejected`, so downstream readers skip it and the rejection stays visible.
- **Add a note** — a free-text "why / context" note, attached to a rejection or standing on its own.
- **Undo last** — drop the most recent unsaved action on a recommendation.

## How it works

1. `main.py` calls `serve(batch_dir, "report")`. The bundled `review_server.py` loads the draft (or the reviewed sibling) via `review.py`'s `load_review_bundle`.
2. It serves the single static `review_ui.html` from a localhost HTTP server. No external requests, no CDN.
3. Every action appends an entry to an in-memory **correction log** — `approve` / `field` / `reject` / `note`. The log is append-only and replayable.
4. On Save, `POST /api/save` hands the edited document + full log to `review.py`'s `write_reviewed`, which strips any stale `review` stamps, re-derives them from the log, validates the envelope, attaches file-level provenance, and atomically writes `findings.report.reviewed.json`.

The correction-provenance contract lives in the bundled `review.py`, the same contract `learn-from-report-corrections` reads. The engine is `kind`-parametrised: `review-analysis` runs it with a phase-3 `kind`, this skill runs it with `report`. No new server, no new UI — only the `kind` differs.

## Out of scope

- Producing the draft — that's `synthesize-report`.
- Turning the corrections into improvement opportunities for `synthesize-report` — that's the sibling skill `learn-from-report-corrections`.
- Reviewing the phase-3 findings, the Segment tree, or the external-context bundle — those are `review-analysis`, `review-transcript-segments`, and `review-external-context`.
- Re-running the synthesis — a rejected recommendation is left in place and stamped, not regenerated. Re-run `synthesize-report` for a fresh draft.

## Privacy

- Secret-redaction runs once, at acquire time (phase 1). `findings.report.json` was synthesized from already-redacted findings, so `findings.report.reviewed.json` is written as-is — no second redaction pass here.
- The localhost server has no public binding and no upload endpoint.
- `findings.report.json` is never modified.
