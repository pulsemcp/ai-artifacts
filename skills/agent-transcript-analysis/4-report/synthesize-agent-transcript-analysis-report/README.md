# `synthesize-agent-transcript-analysis-report`

Phase 4's synthesis skill. Runs once over a whole batch of analyzed transcripts: reads every transcript's phase-3 findings and produces the one final, actionable recommendation slate — `findings.report.json` and `report.md` (human-readable).

## Why this exists

Phase 3 ends with **labels**: flat lists of conclusions, one file per bucket, per transcript. Nobody can act on a label. Someone has to cluster the findings across the whole batch, route them into Prompting / Skills / MCP, cross-check them against team philosophy, prioritize them, dedupe them, and write the result down as next steps. That work — the **leap from analysis to recommendations** — is its own interpretive step, and the pipeline gives it its own phase so the leap is visible, reviewable, and improvable.

The orchestrator (`analyze-agent-transcript`) just *drives* per transcript — pick up `segments.json` → fan out → write findings — and stops. It never touches phase 4. The report is a first-class, batch-level artifact, produced once over the batch rather than once per transcript.

## Files

| File | Role |
|---|---|
| `SKILL.md` | The skill contract — an LLM-driven synthesis skill (no server, no UI). |
| `README.md` | This file. |

It has no `main.py`: the work is reading findings JSON and writing a report, which the agent does directly — the same shape as the phase-3 analyzers.

## Input → output

```
transcript-tmp-dir-1/                 # one per analyzed transcript in the batch
  findings.outcomes.json              # read
  findings.prompts.json               # read
  findings.skills.json                # read
  findings.mcp.json                   # read
  segments.json                       # read — north-star counts, aggregated
  external-context.json               # read — optional grounding
transcript-tmp-dir-2/ … -N/           # same, for every other transcript in the batch
batch_dir/
  findings.cross-transcript.json      # read when present
       │
       ▼
batch_dir/
  findings.report.json   # written: {kind:"report", items:[…]} — the recommendation slate
  report.md              # written: the human-readable final report
```

## The `findings.report.json` envelope

`findings.report.json` is the **same envelope as every phase-3 findings file** — `{kind, items: [{id, …}]}` — with `kind: "report"`. Reusing the envelope keeps every artifact in the pipeline shaped the same way, so tooling that reads one findings file reads them all.

Each item is one recommendation: `bucket` (prompting / skills / mcp), `action` (create / modify / delete / adopt / stop), `title`, `recommendation`, `rationale`, `sources` (the phase-3 finding ids it was synthesized from), `priority`, `effort`, `philosophy_check`. The `sources` list is what makes the leap auditable — each recommendation can be traced back to the findings it claims to follow from.

## Design decisions

- **The synthesis is its own phase — and the orchestrator never touches it.** Labeling (phase 3) and synthesis (phase 4) are different kinds of work. `analyze-agent-transcript` stops at per-transcript findings; it does not invoke this skill. Synthesis runs independently, once, after the batch is done.
- **One batch-final report.** Phases 1–3 run per transcript and accumulate `findings.*.json` sets. This skill runs once over all of them and produces a single report — not one report per transcript. A batch of one transcript is valid input, but there is no separate single-transcript mode: it is always "the batch." One report keeps the recommendation slate deduped and prioritized across everything analyzed, and gives the reviewer one slate to work through instead of N.
- **Batch artifacts live in `batch_dir`.** `findings.report.json` and `report.md` are written to a batch-level working directory, distinct from any single transcript's `tmp_dir` — the per-transcript `tmp_dir`s hold only their own findings. `findings.cross-transcript.json` lives in `batch_dir` too.
- **Same envelope as phase-3 findings.** `findings.report.json` is `{kind, items}` with `kind: "report"`, keeping every artifact in the pipeline shaped the same way so tooling that reads one findings file reads them all.
- **`sources` makes the leap auditable.** Every recommendation names the finding ids it was synthesized from — drawn from any transcript in the batch, or from `findings.cross-transcript.json`. Without that, the leap from analysis to recommendations would be unfalsifiable.
- **Two artifacts, one truth.** `findings.report.json` is the source of truth; `report.md` is the human-readable render. If they disagree, re-render `report.md` from the JSON.
- **The north-star block aggregates across the batch.** Failure counts, Correction triggers, wall-clock vs counterfactual, deterministic-trigger candidates — all summed across every transcript in the batch from each one's `segments.json`. A transcript missing `segments.json` is noted, not fatal.
