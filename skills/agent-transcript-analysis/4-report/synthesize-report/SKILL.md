---
name: synthesize-report
description: >
  Phase-4 synthesis — runs once over a whole batch of analyzed transcripts.
  Given the per-transcript tmp_dirs that make up the batch, reads every
  transcript's phase-3 findings (findings.outcomes/prompts/skills/mcp.json) plus
  findings.cross-transcript.json when present, and synthesizes them into ONE
  final report of actionable next steps across three buckets: human prompting,
  Skills (create/modify/delete), and MCP servers (create/modify/delete). Writes
  findings.report.json (the reviewable recommendation slate) and report.md (the
  human-readable report, including the distance-from-ideal north-star block
  aggregated across the batch) into a batch_dir. Use once the user has finished
  analyzing every transcript of interest — a batch of one transcript is valid
  input too. Never driven by analyze-agent-transcript.
user-invocable: true
---

# Synthesize report

Phase 3 produces **labels** — flat lists of conclusions about Outcomes, Prompts, Skills, and MCP servers, one set per transcript. This skill produces the **synthesis**: it reads the whole batch's findings and turns them into a prioritized, deduped slate of actionable next steps a human can act on — open a PR, rewrite a prompting habit, file an issue.

This is the one place the pipeline makes the **leap from analysis to recommendations**, and it makes it **once, over the whole batch** — not per transcript. A finding says "this Skill fired on a Segment it had no business firing on"; a recommendation says "narrow `analyze-skill-X`'s description — here's the change, here's the priority, here are the findings that motivate it." Phase 3 never makes that leap; phase 4 does, once, in one place, so the leap itself is reviewable (`review-report`) and improvable (`learn-from-report-corrections`).

`synthesize-report` runs **after the batch is complete** — once the user has analyzed every transcript of interest. It is never invoked by `analyze-agent-transcript`; the orchestrator stops at per-transcript findings and has nothing to do with the report.

## Inputs

- `transcripts` (required): the list of per-transcript `tmp_dir`s that make up the batch — each one a folder `analyze-agent-transcript` ran over. From each, this skill reads the phase-3 findings set: `findings.outcomes.json`, `findings.prompts.json`, `findings.skills.json`, `findings.mcp.json`, preferring the `.reviewed.json` sibling of any file when it exists — a human-blessed finding is stronger input than a raw draft. A batch of one `tmp_dir` is valid; it is still "the batch," not a distinct single-transcript mode. Every findings item carries `id` (unique within its file), `segment_id`, `analyzer`, plus analyzer-specific fields, in the shared `{kind, items: […]}` envelope; evidence references are OpenTranscripts event ids, never integer turn indices. Item id schemes may diverge across transcripts (different orchestrator runs number differently) — treat ids as unique batch-wide and carry them into `sources` as-is.
- `batch_dir` (optional): a batch-level working directory, distinct from any single transcript's `tmp_dir`. The report artifacts are written here. Defaults to a new tmp dir created for the batch.
- `findings.cross-transcript.json` (optional): when `analyze-cross-transcript-patterns` has been run over the batch, it lands in `batch_dir` — read it alongside the per-transcript findings. Absent is fine: the report simply has no cross-transcript findings folded in.
- `segments.json` (optional, in each transcript's `tmp_dir`): the Segment tree, used only for the distance-from-ideal north-star block, which aggregates across the batch. Prefer `segments.reviewed.json` when present. If a transcript is missing `segments.json`, note the omission for that transcript rather than failing.
- `external_context` (optional, in each transcript's `tmp_dir`): `external-context.json` or `external-context.reviewed.json`. The ticket / PR / user context behind a session — used to judge whether a recommendation is worth the user's time given what they were actually trying to do.
- `philosophy_skills` / `philosophy_mcp` (optional): the `philosophy-on-skills` and `philosophy-on-mcp` references. Default to the bundled copies. Every Skill/MCP recommendation is cross-checked against them before it lands in the report.

## Outputs

Two files written into `batch_dir`:

- **`findings.report.json`** — the **reviewable recommendation slate**. Same envelope as every phase-3 findings file (`{kind, items: [{id, …}]}`) with `kind: "report"`, so `review-report` reviews it with the exact same engine `review-analysis` uses for phase-3 findings. Each item is one recommendation:

  ```json
  {
    "kind": "report",
    "items": [
      {
        "id": "rec-001",
        "bucket": "prompting | skills | mcp",
        "action": "create | modify | delete | adopt | stop",
        "title": "<short actionable headline>",
        "recommendation": "<the next step, specific enough to act on>",
        "rationale": "<the leap: why these findings imply this recommendation>",
        "sources": ["<finding id>", "..."],
        "priority": "high | medium | low",
        "effort": "<rough sizing — a sentence is fine>",
        "philosophy_check": "<how it squares with philosophy-on-skills / -mcp, or 'n/a'>"
      }
    ]
  }
  ```

  `sources` is what makes the leap auditable: it points back at the exact phase-3 finding ids a recommendation was synthesized from, so `review-report` can check whether the recommendation actually follows from them. A `source` id may come from any transcript in the batch (or from `findings.cross-transcript.json`).

- **`report.md`** — the **human-readable final report**. Structure:

  ```
  # Batch report over <N> transcript(s)

  ## Recommendations
    ### Prompting
      - <recommendation> — <priority> — sources: <finding ids>
    ### Skills
      - create / modify / delete <recommendation> — <priority> — sources: …
    ### MCP
      - create / modify / delete <recommendation> — <priority> — sources: …

  ## Distance from ideal end-state
    Single paragraph, aggregated across the whole batch: how many Failure
    Outcomes, how many Correction triggers (broken out by user-source vs
    agent-source), total wall-clock vs sum of human counterfactuals, count of
    user-source New triggers flagged as deterministic-trigger candidates —
    summed across every transcript in the batch. The north-star, measured.
    Sources differ by quantity: Failure / Correction / wall-clock counts come
    from each transcript's segments.json (prefer segments.reviewed.json); the
    human-counterfactual sum comes from the efficiency findings in each
    transcript's findings.outcomes.json (where human_counterfactual_s lives —
    it is NOT in segments.json). Sum only root-segment-level counterfactuals:
    child-segment counterfactuals roll up into their parent, so summing every
    segment double-counts. If a transcript is missing segments.json, note that
    transcript's omission rather than failing.

  ## Provenance
    Which transcripts, and which findings files (draft or reviewed) from each,
    fed this report; whether findings.cross-transcript.json was present.
  ```

`report.md` is the artifact a human reads; `findings.report.json` is the artifact `review-report` corrects. They carry the same recommendations — if they ever disagree, `findings.report.json` is the source of truth and `report.md` is re-rendered from it.

## One report, over the batch

`synthesize-report` is **single-mode**: it always synthesizes "the batch." It is given the list of per-transcript `tmp_dir`s that make up the batch, reads every transcript's findings (plus `findings.cross-transcript.json` when present), and produces the **one final report** — the prioritized, deduped slate of action items across the three buckets. This single report is the pipeline's final output. A batch of one transcript is valid input — but there is no distinct "single-transcript mode," and the orchestrator never drives this skill.

## Sequencing checklist

- [ ] Resolve `batch_dir` (create a new tmp dir for the batch if none was given). Take the list of per-transcript `tmp_dir`s that make up the batch
- [ ] In each transcript's `tmp_dir`, discover the findings files. For each bucket, prefer `findings.<kind>.reviewed.json` over `findings.<kind>.json`. Record which you used per transcript — it goes in the report's Provenance section
- [ ] Check `batch_dir` for `findings.cross-transcript.json` (preferring `findings.cross-transcript.reviewed.json`). If present, read it as one more findings source; if absent, proceed without it
- [ ] Read every finding across every transcript. Drop items stamped `review.verdict == "rejected"` — a human already threw them out
- [ ] **Synthesize, don't restate.** Cluster findings that point at the same change — across transcripts, not just within one. A recommendation usually draws on several findings. Each recommendation gets a `sources` list naming the finding ids it came from
- [ ] **Route into three buckets.** `outcomes` findings carry a `recommendation_route` — follow it. `prompts` findings feed Prompting; `skills` feed Skills; `mcp` feed MCP. No cross-bucket invention
- [ ] **Cross-check every Skill/MCP recommendation against the philosophy docs.** A recommendation that contradicts `philosophy-on-skills` or `philosophy-on-mcp` is dropped, or kept with the contradiction spelled out in `philosophy_check` for the reviewer to resolve
- [ ] **Prioritize.** Every recommendation gets `priority` and a rough `effort`. A report where everything is "high" helps no one
- [ ] **Dedupe.** The same Skill gap surfacing in five Segments across three transcripts is one recommendation with five `sources`, not five recommendations
- [ ] Compute the **distance-from-ideal** block by aggregating across the batch. Failure counts, Correction triggers (split user-source vs agent-source), wall-clock totals, and deterministic-trigger candidates come from each transcript's `segments.json` (prefer `segments.reviewed.json`). The human-counterfactual sum does **not** — `human_counterfactual_s` lives in the efficiency findings of each transcript's `findings.outcomes.json`; pull it from there. Sum only **root-segment-level** counterfactuals: a child segment's counterfactual rolls up into its parent, so summing every segment double-counts. Sum each quantity over every transcript. If a transcript is missing `segments.json`, note that transcript's omission rather than failing
- [ ] Write `findings.report.json` (the `{kind: "report", items: […]}` envelope) and `report.md` into `batch_dir`. Print both paths to stdout
- [ ] Point the user at `review-report` — the leap from findings to recommendations is interpretive and earns a human checkpoint, the same way phase 2 and phase 3 do

## Out of scope

- Producing the findings — that's the phase-3 analyzers (`analyze-*`), driven per transcript by `analyze-agent-transcript`, plus `analyze-cross-transcript-patterns` for the optional `findings.cross-transcript.json`.
- Deciding the batch is complete — the user signals that (no more transcripts of interest). This skill runs once that has happened.
- Human review of the report — that's `review-report`, the phase-4 checkpoint over `findings.report.json` in `batch_dir`.
- Turning review corrections into improvements — that's `learn-from-report-corrections`.
- Re-deriving anything from `transcript.json` or raw JSONL. This skill reads phase-3 findings (and `segments.json` only for the north-star counts). If a finding is wrong, fix the analyzer that drafted it — don't patch around it here.

## Notes

- **The leap is the product.** Phase 3 is deliberately conservative — it labels and stops. The value this skill adds is the synthesis: clustering across the whole batch, routing, prioritizing, and the explicit `rationale` + `sources` that make each leap inspectable.
- **Reviewed input beats draft input.** Always prefer `findings.<kind>.reviewed.json`. A report synthesized from human-blessed findings needs less correction than one synthesized from raw drafts.
- **Same envelope as phase 3, on purpose.** `findings.report.json` is `{kind, items}` so the review subsystem (`review.py` + `review_server.py` + `review_ui.html`) reviews it unchanged — `review-report` is a thin wrapper, not a new UI.
- **Privacy.** The findings this reads were synthesized from already-redacted Segments upstream (phase 1 redacts at acquire time). This skill writes `findings.report.json` and `report.md` as-is — no redaction pass here.
