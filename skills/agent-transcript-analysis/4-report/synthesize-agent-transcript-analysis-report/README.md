# `synthesize-agent-transcript-analysis-report`

Phase 4's synthesis skill. Runs once over a whole batch of analyzed transcripts: reads every transcript's phase-3 findings and produces the one final, actionable recommendation slate — `findings.report.json` and `report.md` (human-readable).

## Why this exists

Phase 3 ends with **labels**: flat lists of conclusions, one file per bucket, per transcript. Nobody can act on a label. Someone has to cluster the findings across the whole batch, route them into Prompting / Skills / MCP, cross-check them against team philosophy, prioritize them, dedupe them, and write the result down as next steps. That work — the **leap from analysis to recommendations** — is its own interpretive step, and the pipeline gives it its own phase so the leap is visible, reviewable, and improvable.

The orchestrator (`analyze-agent-transcript`) just *drives* per transcript — pick up `segments.json` → fan out → write findings — and stops. It never touches phase 4. The report is a first-class, batch-level artifact, produced once over the batch rather than once per transcript.

## Files

| File | Role |
|---|---|
| `SKILL.md` | The skill contract — an LLM-driven synthesis skill. No server and no interactive app, but it does emit a static HTML site (see below). |
| `README.md` | This file. |

It has no `main.py`: the work is reading findings JSON and writing a report — including a multi-page static HTML site — which the agent does directly, the same shape as the phase-3 analyzers. The HTML it writes is a **read-only drilldown**: plain static pages the reader clicks deeper and deeper into, with no review, edit, or annotation surface anywhere.

## Input → output

```
transcript-tmp-dir-1/                 # one per analyzed transcript in the batch
  findings.outcomes.json              # read
  findings.prompts.json               # read
  findings.skills.json                # read
  findings.mcp.json                   # read
  segments.json                       # read — north-star counts + session/segment pages
  external-context.json               # read — optional grounding + context pages
transcript-tmp-dir-2/ … -N/           # same, for every other transcript in the batch
batch_dir/
  findings.cross-transcript.json      # read when present
       │
       ▼
batch_dir/
  findings.report.json               # written: {kind:"report", items:[…]} — the recommendation slate
  report.md                          # written: the human-readable final report
  report.html                        # written: HTML landing page
  recommendations/rec-<NNN>.html     # written: one per recommendation
  sessions/<short-tag>.html          # written: one per transcript — segmentation overview
  segments/<short-tag>--<SID>.html   # written: one per Segment — deepest drilldown
  context/<short-tag>.html           # written: one per transcript with external context
  cross-transcript.html              # written: when findings.cross-transcript.json present
```

The findings and `segments.json` are read **twice**: once clustered across the batch to synthesize the recommendation slate, and once grouped by `segment_id` to render the per-Segment drilldown pages — so every decision the pipeline made is reachable in the site, not just the ones that motivated a recommendation.

## The `findings.report.json` envelope

`findings.report.json` is the **same envelope as every phase-3 findings file** — `{kind, items: [{id, …}]}` — with `kind: "report"`. Reusing the envelope keeps every artifact in the pipeline shaped the same way, so tooling that reads one findings file reads them all.

Each item is one recommendation: `priority`, `bucket` (prompting / skills / mcp), `action` (create / modify / delete / adopt / stop), `subject` (the named artifact the rec is about), `problem` (the headline — what went wrong), `recommendation`, `rationale`, `proposed_change` (a short diff or draft), and `inspiring_segments` (the real Segments + before/after evidence chains the rec was synthesized from). The `inspiring_segments` chains are what make the leap auditable — each recommendation traces back to actual Segments and raw events, not an opaque finding-id list. (See `SKILL.md` for the full field semantics.)

## Design decisions

- **The synthesis is its own phase — and the orchestrator never touches it.** Labeling (phase 3) and synthesis (phase 4) are different kinds of work. `analyze-agent-transcript` stops at per-transcript findings; it does not invoke this skill. Synthesis runs independently, once, after the batch is done.
- **One batch-final report.** Phases 1–3 run per transcript and accumulate `findings.*.json` sets. This skill runs once over all of them and produces a single report — not one report per transcript. A batch of one transcript is valid input, but there is no separate single-transcript mode: it is always "the batch." One report keeps the recommendation slate deduped and prioritized across everything analyzed, and gives the reviewer one slate to work through instead of N.
- **Batch artifacts live in `batch_dir`.** `findings.report.json` and `report.md` are written to a batch-level working directory, distinct from any single transcript's `tmp_dir` — the per-transcript `tmp_dir`s hold only their own findings. `findings.cross-transcript.json` lives in `batch_dir` too.
- **Same envelope as phase-3 findings.** `findings.report.json` is `{kind, items}` with `kind: "report"`, keeping every artifact in the pipeline shaped the same way so tooling that reads one findings file reads them all.
- **`inspiring_segments` makes the leap auditable.** Every recommendation names the real Segments it was synthesized from — drawn from any transcript in the batch, or from `findings.cross-transcript.json` — each with a before/after chain of raw events. Without that grounding, the leap from analysis to recommendations would be unfalsifiable; a flat list of finding ids was unverifiable noise to a reader, so it was replaced by Segments + evidence chains.
- **Two artifacts, one truth.** `findings.report.json` is the source of truth; `report.md` is the human-readable render. If they disagree, re-render `report.md` from the JSON.
- **The HTML companion is a read-only drilldown.** `report.md` and `findings.report.json` carry the recommendation slate; the HTML site lets a reader click *past* the slate into every intermediate decision the pipeline made — from a recommendation, to the Segment that inspired it, to every phase-3 finding tagged on that Segment, to the raw events behind each finding, and out to the external ticket/PR and cross-transcript patterns. It exposes the component pieces purely for inspection: there is no annotation, correction, or accept/reject surface (that was deliberately removed from the pipeline). Disagree with a decision? Fix the upstream phase and re-run — don't edit the report.
- **The north-star block aggregates across the batch.** Failure counts, Correction triggers, wall-clock vs counterfactual, deterministic-trigger candidates — all summed across every transcript in the batch from each one's `segments.json`. A transcript missing `segments.json` is noted, not fatal.
