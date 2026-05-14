# Tier 4: `4-report`

The synthesis layer. Tier 3 produces **labels** — flat lists of conclusions. Tier 4 makes the **leap from those labels to recommendations**: it turns the findings into one consolidated, prioritized slate of actionable next steps, and gives a human the chance to correct that leap before anyone acts on it.

## Skills in this tier

- `synthesize-report/` — reads the tier-3 findings (`findings.{outcomes,prompts,skills,mcp}.json`, or `findings.cross-transcript.json` for a batch) and synthesizes them into `findings.report.json` (the reviewable recommendation slate) and `report.md` (the human-readable report, with the distance-from-ideal north-star block). LLM-driven; no `main.py`.
- `review-report/` — **optional human review checkpoint.** Opens a localhost UI to audit and correct the synthesized recommendation slate; writes `findings.report.reviewed.json` next to the draft with full correction provenance. The draft is never overwritten.
- `learn-from-report-corrections/` — **optional feedback loop.** Reads the corrections captured by `review-report`, clusters them into patterns, and flags concrete improvement opportunities for `synthesize-report` — it does not edit any skill.

## How this tier plugs into the rest

`analyze-agent-transcript` (the entry point of tier 3) drives the pipeline from tier 2's `segments.json` through the four per-Segment tier-3 buckets, writing `findings.{outcomes,prompts,skills,mcp}.json`. Its **final step is invoking `synthesize-report`** — so a full single-session run ends with a `report.md` and a reviewable `findings.report.json`, not just raw findings.

`synthesize-report` can also be run **directly** on a cross-transcript batch: given a `findings.cross-transcript.json` from `analyze-cross-transcript-patterns`, it produces a report scoped to habits visible only across sessions. Same skill, same output shape.

Tier 4 reads only the tier-3 findings (and `segments.json` for the north-star counts). It never re-walks `transcript.json` or raw JSONL — if a finding is wrong, fix the tier-3 analyzer that drafted it and re-run.

## The review loop

`synthesize-report` emits an AI *draft*. Two skills close a human-in-the-loop loop over it:

```
synthesize-report             →  findings.report.json (AI draft) + report.md
review-report                 →  findings.report.reviewed.json + append-only correction log
learn-from-report-corrections →  flagged opportunities for synthesize-report
       └──────────────────────── close the loop ────────────────────────┘
```

This is the same loop tier 2 and tier 3 already run — `decompose` / `review-transcript-segments` / `learn-from-segment-corrections` and `analyze-*` / `review-analysis` / `learn-from-analysis-corrections`. Tier 4 reuses the tier-3 review *engine* outright: `findings.report.json` is the same `{kind, items}` envelope as a tier-3 findings file (`kind: "report"`), so `review-report` is a thin wrapper over the bundled `review.py` / `review_server.py` / `review_ui.html` — `REPORT_KIND` was reserved in that contract from the start.

## Design decisions

- **Synthesis is its own tier, not a step inside the orchestrator.** The leap from labels to recommendations is the most consequential interpretive step in the pipeline — it is what a human acts on. Burying it in `analyze-agent-transcript` hid it from review. Promoting it to a tier gives it the same draft / review / learn loop every other interpretive step has.
- **Labeling (tier 3) and synthesis (tier 4) are different kinds of work.** Tier 3 asks "is this true?"; tier 4 asks "so what should we do?". Keeping them in separate tiers keeps each reviewable on its own terms — `review-analysis` checks whether a finding is true, `review-report` checks whether a recommendation follows from the findings it cites.
- **Same envelope as tier-3 findings, so the review engine is reused outright.** `findings.report.json` is `{kind, items}` with `kind: "report"`. No new server, no new UI — `review-report` runs the same engine `review-analysis` runs, parametrised only by `kind`.
- **Two artifacts, one truth.** `findings.report.json` is the source of truth (it is what `review-report` corrects); `report.md` is the human-readable render. If they disagree, re-render `report.md` from the JSON.
- **One synthesis skill, two modes.** Single-transcript (driven by the orchestrator) and cross-transcript batch (invoked directly) are the same synthesis over different input buckets — not two skills.
