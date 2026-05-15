# `synthesize-agent-transcript-analysis-report`

Phase 4's synthesis skill. Runs once over a whole batch of analyzed transcripts: reads every transcript's phase-3 findings and produces the one final, actionable recommendation slate — `findings.report.json` (reviewable) and `report.md` (human-readable).

## Why this exists

Phase 3 ends with **labels**: flat lists of conclusions, one file per bucket, per transcript. Nobody can act on a label. Someone has to cluster the findings across the whole batch, route them into Prompting / Skills / MCP, cross-check them against team philosophy, prioritize them, dedupe them, and write the result down as next steps. That work — the **leap from analysis to recommendations** — is its own interpretive step, and the pipeline gives it its own phase so the leap is visible, reviewable, and improvable.

The orchestrator (`analyze-agent-transcript`) just *drives* per transcript — pick up `segments.json` → fan out → write findings — and stops. It never touches phase 4. The report is a first-class, batch-level artifact with its own review checkpoint — exactly the shape phases 2 and 3 already have, but produced once over the batch rather than once per transcript.

## Files

| File | Role |
|---|---|
| `SKILL.md` | The skill contract — an LLM-driven synthesis skill (no server, no UI). |
| `README.md` | This file. |

It has no `main.py`: the work is reading findings JSON and writing a report, which the agent does directly — the same shape as the phase-3 analyzers and `learn-from-agent-transcript-analysis-corrections`.

## Input → output

```
transcript-tmp-dir-1/                 # one per analyzed transcript in the batch
  findings.outcomes.json              # read (prefer .reviewed.json)
  findings.prompts.json               # read (prefer .reviewed.json)
  findings.skills.json                # read (prefer .reviewed.json)
  findings.mcp.json                   # read (prefer .reviewed.json)
  segments.json                       # read — north-star counts, aggregated (prefer .reviewed.json)
  external-context.json               # read — optional grounding (prefer .reviewed.json)
transcript-tmp-dir-2/ … -N/           # same, for every other transcript in the batch
batch_dir/
  findings.cross-transcript.json      # read when present (prefer .reviewed.json)
       │
       ▼
batch_dir/
  findings.report.json   # written: {kind:"report", items:[…]} — the reviewable slate
  report.md              # written: the human-readable final report
```

## The `findings.report.json` envelope

`findings.report.json` is the **same envelope as every phase-3 findings file** — `{kind, items: [{id, …}]}` — with `kind: "report"`. That is deliberate: `review-agent-transcript-analysis-report` reviews it with the exact same engine (`review.py` + `review_server.py` + `review_ui.html`) that `review-agent-transcript-analysis` uses for phase-3 findings. `REPORT_KIND` was reserved in that engine from the start for precisely this.

Each item is one recommendation: `bucket` (prompting / skills / mcp), `action` (create / modify / delete / adopt / stop), `title`, `recommendation`, `rationale`, `sources` (the phase-3 finding ids it was synthesized from), `priority`, `effort`, `philosophy_check`. The `sources` list is what makes the leap auditable — `review-agent-transcript-analysis-report` checks each recommendation against the findings it claims to follow from.

## The phase-4 loop

```
synthesize-agent-transcript-analysis-report             →  findings.report.json (AI draft) + report.md
review-agent-transcript-analysis-report                 →  findings.report.reviewed.json + correction log
learn-from-agent-transcript-analysis-report-corrections →  flagged opportunities for synthesize-agent-transcript-analysis-report
        └────────────────── close the loop ──────────────────┘
```

Same shape as phase 2 (`decompose` → `review-agent-transcript-segments` → `learn-from-agent-transcript-segment-corrections`) and phase 3 (`analyze-*` → `review-agent-transcript-analysis` → `learn-from-agent-transcript-analysis-corrections`).

## Design decisions

- **The synthesis is its own phase — and the orchestrator never touches it.** Labeling (phase 3) and synthesis (phase 4) are different kinds of work, and the leap between them is exactly the kind of interpretive step the plugin gives a review checkpoint. `analyze-agent-transcript` stops at per-transcript findings; it does not invoke this skill. Synthesis runs independently, once, after the batch is done.
- **One batch-final report.** Phases 1–3 run per transcript and accumulate `findings.*.json` sets. This skill runs once over all of them and produces a single report — not one report per transcript. A batch of one transcript is valid input, but there is no separate single-transcript mode: it is always "the batch." One report keeps the recommendation slate deduped and prioritized across everything analyzed, and gives the reviewer one slate to work through instead of N.
- **Batch artifacts live in `batch_dir`.** `findings.report.json` and `report.md` are written to a batch-level working directory, distinct from any single transcript's `tmp_dir` — the per-transcript `tmp_dir`s hold only their own findings. `findings.cross-transcript.json` lives in `batch_dir` too.
- **Same envelope as phase-3 findings.** `findings.report.json` is `{kind, items}` with `kind: "report"`, so the review subsystem reviews it with no new code — `review-agent-transcript-analysis-report` is a thin wrapper over the shared engine, not a second UI.
- **`sources` makes the leap auditable.** Every recommendation names the finding ids it was synthesized from — drawn from any transcript in the batch, or from `findings.cross-transcript.json`. Without that, "review the leap from analysis to recommendations" would be unfalsifiable.
- **Two artifacts, one truth.** `findings.report.json` is the source of truth (it is what gets reviewed and corrected); `report.md` is the human-readable render. If they disagree, re-render `report.md` from the JSON.
- **Reviewed input beats draft input.** The skill always prefers `findings.<kind>.reviewed.json` over the raw draft — synthesizing from human-blessed findings means less to correct downstream.
- **The north-star block aggregates across the batch.** Failure counts, Correction triggers, wall-clock vs counterfactual, deterministic-trigger candidates — all summed across every transcript in the batch from each one's `segments.json`. A transcript missing `segments.json` is noted, not fatal.
