---
name: synthesize-report
description: >
  Tier-5 synthesis. Take the tier-4 findings for a transcript — the flat
  conclusion lists in findings.outcomes.json / findings.prompts.json /
  findings.skills.json / findings.mcp.json (and findings.cross-transcript.json
  for a cross-transcript batch) — and synthesize them into one consolidated
  report of actionable next steps across three buckets: human prompting, Skills
  (create/modify/delete), and MCP servers (create/modify/delete). Writes
  findings.report.json (the reviewable recommendation slate) and report.md (the
  human-readable report, including the distance-from-ideal north-star block).
  Use after the tier-4 analyzers have run — driven by analyze-agent-transcript
  for a single session, or invoked directly on a cross-transcript batch.
user-invocable: true
---

# Synthesize report

Tier 4 produces **labels** — flat lists of conclusions about Outcomes, Prompts, Skills, and MCP servers. This skill produces the **synthesis**: it reads those findings and turns them into a prioritized, deduped slate of actionable next steps a human can act on — open a PR, rewrite a prompting habit, file an issue.

This is the one place the pipeline makes the **leap from analysis to recommendations**. A finding says "this Skill fired on a Segment it had no business firing on"; a recommendation says "narrow `analyze-skill-X`'s description — here's the change, here's the priority, here are the findings that motivate it." Tier 4 never makes that leap; tier 5 does, once, in one place, so the leap itself is reviewable (`review-report`) and improvable (`learn-from-report-corrections`).

## Inputs

- `tmp_dir` (required): a transcript tmp_dir. Must contain at least one tier-4 findings file — `findings.outcomes.json`, `findings.prompts.json`, `findings.skills.json`, `findings.mcp.json` (the per-Segment buckets), or `findings.cross-transcript.json` (the cross-transcript bucket). Prefer the `.reviewed.json` sibling of any file when it exists — a human-blessed finding is stronger input than a raw draft.
- `segments.json` (optional, same `tmp_dir`): the Segment tree, used only for the distance-from-ideal north-star block. Prefer `segments.reviewed.json` when present. Absent → emit the report without the north-star block and note the omission.
- `external_context` (optional, same `tmp_dir`): `external-context.json` or `external-context.reviewed.json`. The ticket / PR / user context behind the session — used to judge whether a recommendation is worth the user's time given what they were actually trying to do.
- `philosophy_skills` / `philosophy_mcp` (optional): the `philosophy-on-skills` and `philosophy-on-mcp` references. Default to the bundled copies. Every Skill/MCP recommendation is cross-checked against them before it lands in the report.

## Outputs

Two files written into `tmp_dir`:

- **`findings.report.json`** — the **reviewable recommendation slate**. Same envelope as every tier-4 findings file (`{kind, items: [{id, …}]}`) with `kind: "report"`, so `review-report` reviews it with the exact same engine `review-analysis` uses for tier-4 findings. Each item is one recommendation:

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

  `sources` is what makes the leap auditable: it points back at the exact tier-4 finding ids a recommendation was synthesized from, so `review-report` can check whether the recommendation actually follows from them.

- **`report.md`** — the **human-readable consolidated report**. Structure:

  ```
  # Session <id> report   (or: Cross-transcript report over <N> sessions)

  ## Recommendations
    ### Prompting
      - <recommendation> — <priority> — sources: <finding ids>
    ### Skills
      - create / modify / delete <recommendation> — <priority> — sources: …
    ### MCP
      - create / modify / delete <recommendation> — <priority> — sources: …

  ## Distance from ideal end-state
    Single paragraph (single-transcript mode only): how many Failure Outcomes,
    how many Correction triggers (broken out by user-source vs agent-source),
    total wall-clock vs sum of human counterfactuals, count of user-source New
    triggers flagged as deterministic-trigger candidates. The north-star,
    measured. Omitted with a note when segments.json is absent.

  ## Provenance
    Which findings files (and whether draft or reviewed) fed this report.
  ```

`report.md` is the artifact a human reads; `findings.report.json` is the artifact `review-report` corrects. They carry the same recommendations — if they ever disagree, `findings.report.json` is the source of truth and `report.md` is re-rendered from it.

## Two modes

- **Single-transcript** — the common path. `analyze-agent-transcript` invokes this skill as its final step, against the `findings.{outcomes,prompts,skills,mcp}.json` it just wrote. Produces that session's report.
- **Cross-transcript batch** — invoked directly (not by the orchestrator), against a `tmp_dir` that holds a `findings.cross-transcript.json` from `analyze-cross-transcript-patterns`. Produces a report whose recommendations are scoped to habits visible only across sessions. Same skill, same output shape — only the input bucket and the `report.md` title differ.

## Sequencing checklist

- [ ] Discover the findings files in `tmp_dir`. For each bucket, prefer `findings.<kind>.reviewed.json` over `findings.<kind>.json`. Record which you used — it goes in the report's Provenance section
- [ ] Read every finding. Drop items stamped `review.verdict == "rejected"` — a human already threw them out
- [ ] **Synthesize, don't restate.** Cluster findings that point at the same change; a recommendation usually draws on several findings. Each recommendation gets a `sources` list naming the finding ids it came from
- [ ] **Route into three buckets.** `outcomes` findings carry a `recommendation_route` — follow it. `prompts` findings feed Prompting; `skills` feed Skills; `mcp` feed MCP. No cross-bucket invention
- [ ] **Cross-check every Skill/MCP recommendation against the philosophy docs.** A recommendation that contradicts `philosophy-on-skills` or `philosophy-on-mcp` is dropped, or kept with the contradiction spelled out in `philosophy_check` for the reviewer to resolve
- [ ] **Prioritize.** Every recommendation gets `priority` and a rough `effort`. A report where everything is "high" helps no one
- [ ] **Dedupe.** The same Skill gap surfacing in five Segments is one recommendation with five `sources`, not five recommendations
- [ ] Compute the **distance-from-ideal** block from `segments.json` if present (Failure count; Correction triggers split user-source vs agent-source; wall-clock vs counterfactual sum; deterministic-trigger candidates). If `segments.json` is absent, omit the block and say so
- [ ] Write `findings.report.json` (the `{kind: "report", items: […]}` envelope) and `report.md`. Print both paths to stdout
- [ ] Point the user at `review-report` — the leap from findings to recommendations is interpretive and earns a human checkpoint, the same way tier 2 and tier 4 do

## Out of scope

- Producing the findings — that's the tier-4 analyzers (`analyze-*`), driven by `analyze-agent-transcript`, plus `analyze-cross-transcript-patterns` for the cross-transcript bucket.
- Driving the pipeline — that's `analyze-agent-transcript`. This skill is the *last* step it drives, not the driver.
- Human review of the report — that's `review-report`, the tier-5 checkpoint over `findings.report.json`.
- Turning review corrections into improvements — that's `learn-from-report-corrections`.
- Re-deriving anything from `transcript.json` or raw JSONL. This skill reads tier-4 findings (and `segments.json` only for the north-star counts). If a finding is wrong, fix the analyzer that drafted it — don't patch around it here.

## Notes

- **The leap is the product.** Tier 4 is deliberately conservative — it labels and stops. The value this skill adds is the synthesis: clustering, routing, prioritizing, and the explicit `rationale` + `sources` that make each leap inspectable.
- **Reviewed input beats draft input.** Always prefer `findings.<kind>.reviewed.json`. A report synthesized from human-blessed findings needs less correction than one synthesized from raw drafts.
- **Same envelope as tier 4, on purpose.** `findings.report.json` is `{kind, items}` so the review subsystem (`review.py` + `review_server.py` + `review_ui.html`) reviews it unchanged — `review-report` is a thin wrapper, not a new UI.
- **Privacy.** The findings this reads were synthesized from already-redacted Segments upstream (tier 1 redacts at acquire time). This skill writes `findings.report.json` and `report.md` as-is — no redaction pass here.
