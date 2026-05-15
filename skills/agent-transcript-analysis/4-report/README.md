# Phase 4: `4-report`

The batch-final synthesis layer. Phase 3 produces **labels** — flat lists of conclusions, one set per transcript. Phase 4 makes the **leap from those labels to recommendations**: once the batch is complete, it turns every analyzed transcript's findings into **one** consolidated, prioritized slate of actionable next steps, and gives a human the chance to correct that leap before anyone acts on it.

## Skills in this phase

- `synthesize-report/` — runs once over the whole batch: reads every transcript's phase-3 findings (`findings.{outcomes,prompts,skills,mcp}.json` from each per-transcript `tmp_dir`), plus `findings.cross-transcript.json` from `batch_dir` when present, and synthesizes them into `findings.report.json` (the reviewable recommendation slate) and `report.md` (the human-readable report, with the distance-from-ideal north-star block aggregated across the batch). Both land in `batch_dir`. LLM-driven; no `main.py`.
- `review-report/` — **optional human review checkpoint.** Opens a localhost UI to audit and correct the synthesized recommendation slate in `batch_dir`; writes `findings.report.reviewed.json` next to the draft with full correction provenance. The draft is never overwritten.
- `learn-from-report-corrections/` — **optional feedback loop.** Reads the corrections captured by `review-report`, clusters them into patterns, and flags concrete improvement opportunities for `synthesize-report` — it does not edit any skill.

## How this phase plugs into the rest

`analyze-agent-transcript` (the entry point of phase 3) drives each transcript from phase 2's `segments.json` through the four per-Segment phase-3 buckets, writing `findings.{outcomes,prompts,skills,mcp}.json` — and stops there. There is no per-transcript report, and the orchestrator never invokes `synthesize-report`. Phases 1–3 repeat per transcript; the findings sets accumulate.

Phase 4 runs **once, after the batch is complete** — when the user has no more transcripts to analyze. `synthesize-report` is given the list of per-transcript `tmp_dir`s that make up the batch, reads each one's findings (plus `findings.cross-transcript.json` from `analyze-cross-transcript-patterns`, when that optional batch step was run), and produces the single final report in `batch_dir`.

Phase 4 reads only the phase-3 findings (and each transcript's `segments.json` for the north-star counts). It never re-walks `transcript.json` or raw JSONL — if a finding is wrong, fix the phase-3 analyzer that drafted it and re-run.

## The review loop

`synthesize-report` emits an AI *draft*. Two skills close a human-in-the-loop loop over it:

```
synthesize-report             →  findings.report.json (AI draft) + report.md
review-report                 →  findings.report.reviewed.json + append-only correction log
learn-from-report-corrections →  flagged opportunities for synthesize-report
       └──────────────────────── close the loop ────────────────────────┘
```

This is the same loop phase 2 and phase 3 already run — `decompose` / `review-transcript-segments` / `learn-from-segment-corrections` and `analyze-*` / `review-analysis` / `learn-from-analysis-corrections`. Phase 4 reuses the phase-3 review *engine* outright: `findings.report.json` is the same `{kind, items}` envelope as a phase-3 findings file (`kind: "report"`), so `review-report` is a thin wrapper over the bundled `review.py` / `review_server.py` / `review_ui.html` — `REPORT_KIND` was reserved in that contract from the start.

## Design decisions

- **Synthesis is its own phase, fully outside the orchestrator.** The leap from labels to recommendations is the most consequential interpretive step in the pipeline — it is what a human acts on. The orchestrator (phase 3's entry point) doesn't touch it at all: it drives per-transcript analysis and stops at `findings.*.json`. Phase 4 runs independently, once, after the batch is done — with the same draft / review / learn loop every other interpretive step has.
- **One batch-final report, not one per transcript.** Phases 1–3 run per transcript and end at findings — there is no per-transcript report. `synthesize-report` runs once over the whole batch's findings and produces a single report. Synthesizing per transcript would force the reviewer through N reports and bury the cross-session picture; one batch-final report keeps the recommendation slate deduped and prioritized across everything analyzed. A batch of one transcript is valid input — it is still "the batch," not a distinct mode.
- **Labeling (phase 3) and synthesis (phase 4) are different kinds of work.** Phase 3 asks "is this true?"; phase 4 asks "so what should we do?". Keeping them in separate phases keeps each reviewable on its own terms — `review-analysis` checks whether a finding is true, `review-report` checks whether a recommendation follows from the findings it cites.
- **Same envelope as phase-3 findings, so the review engine is reused outright.** `findings.report.json` is `{kind, items}` with `kind: "report"`. No new server, no new UI — `review-report` runs the same engine `review-analysis` runs, parametrised only by `kind`.
- **Two artifacts, one truth.** `findings.report.json` is the source of truth (it is what `review-report` corrects); `report.md` is the human-readable render. If they disagree, re-render `report.md` from the JSON.
- **Batch artifacts live in `batch_dir`.** The report files — and `findings.cross-transcript.json` — are written to a batch-level working directory, distinct from any single transcript's `tmp_dir`. `review-report` and `learn-from-report-corrections` operate on `findings.report.json` / its `.reviewed.json` in `batch_dir`.
