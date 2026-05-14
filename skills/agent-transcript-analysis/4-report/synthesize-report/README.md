# `synthesize-report`

Tier 4's synthesis skill. Reads the tier-3 findings for a transcript and produces the consolidated, actionable recommendation slate — `findings.report.json` (reviewable) and `report.md` (human-readable).

## Why this exists

Tier 3 ends with **labels**: flat lists of conclusions, one file per bucket. Nobody can act on a label. Someone has to cluster the findings, route them into Prompting / Skills / MCP, cross-check them against team philosophy, prioritize them, and write the result down as next steps. That work — the **leap from analysis to recommendations** — is its own interpretive step, and the pipeline gives it its own tier so the leap is visible, reviewable, and improvable.

Before tier 4 existed, this synthesis was buried inside the tier-3 orchestrator. Pulling it out means the orchestrator just *drives* (pick up `segments.json` → fan out → write findings) and the report is a first-class artifact with its own review checkpoint — exactly the shape tiers 2 and 3 already have.

## Files

| File | Role |
|---|---|
| `SKILL.md` | The skill contract — an LLM-driven synthesis skill (no server, no UI). |
| `README.md` | This file. |

It has no `main.py`: the work is reading findings JSON and writing a report, which the agent does directly — the same shape as the tier-3 analyzers and `learn-from-analysis-corrections`.

## Input → output

```
tmp_dir/
  findings.outcomes.json          # read (prefer .reviewed.json)
  findings.prompts.json           # read (prefer .reviewed.json)
  findings.skills.json            # read (prefer .reviewed.json)
  findings.mcp.json               # read (prefer .reviewed.json)
  findings.cross-transcript.json  # read in cross-transcript mode
  segments.json                   # read — north-star counts only (prefer .reviewed.json)
  external-context.json           # read — optional grounding (prefer .reviewed.json)
       │
       ▼
  findings.report.json   # written: {kind:"report", items:[…]} — the reviewable slate
  report.md              # written: the human-readable consolidated report
```

## The `findings.report.json` envelope

`findings.report.json` is the **same envelope as every tier-3 findings file** — `{kind, items: [{id, …}]}` — with `kind: "report"`. That is deliberate: `review-report` reviews it with the exact same engine (`review.py` + `review_server.py` + `review_ui.html`) that `review-analysis` uses for tier-3 findings. `REPORT_KIND` was reserved in that engine from the start for precisely this.

Each item is one recommendation: `bucket` (prompting / skills / mcp), `action` (create / modify / delete / adopt / stop), `title`, `recommendation`, `rationale`, `sources` (the tier-3 finding ids it was synthesized from), `priority`, `effort`, `philosophy_check`. The `sources` list is what makes the leap auditable — `review-report` checks each recommendation against the findings it claims to follow from.

## The tier-4 loop

```
synthesize-report             →  findings.report.json (AI draft) + report.md
review-report                 →  findings.report.reviewed.json + correction log
learn-from-report-corrections →  flagged opportunities for synthesize-report
        └────────────────── close the loop ──────────────────┘
```

Same shape as tier 2 (`decompose` → `review-transcript-segments` → `learn-from-segment-corrections`) and tier 3 (`analyze-*` → `review-analysis` → `learn-from-analysis-corrections`).

## Design decisions

- **The synthesis is its own tier.** Labeling (tier 3) and synthesis (tier 4) are different kinds of work, and the leap between them is exactly the kind of interpretive step the plugin gives a review checkpoint. Burying it in the orchestrator hid it from review.
- **Same envelope as tier-3 findings.** `findings.report.json` is `{kind, items}` with `kind: "report"`, so the review subsystem reviews it with no new code — `review-report` is a thin wrapper over the shared engine, not a second UI.
- **`sources` makes the leap auditable.** Every recommendation names the finding ids it was synthesized from. Without that, "review the leap from analysis to recommendations" would be unfalsifiable.
- **Two artifacts, one truth.** `findings.report.json` is the source of truth (it is what gets reviewed and corrected); `report.md` is the human-readable render. If they disagree, re-render `report.md` from the JSON.
- **Reviewed input beats draft input.** The skill always prefers `findings.<kind>.reviewed.json` over the raw draft — synthesizing from human-blessed findings means less to correct downstream.
- **One skill, two modes.** Single-transcript (driven by `analyze-agent-transcript`) and cross-transcript batch (invoked directly on a `findings.cross-transcript.json`) are the same synthesis with different input buckets — not two skills.
