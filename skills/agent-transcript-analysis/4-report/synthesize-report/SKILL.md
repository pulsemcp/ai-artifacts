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
  human-readable report grouped by priority, including the distance-from-ideal
  north-star block aggregated across the batch), and a multi-page HTML site
  (report.html landing + recommendations/rec-NNN.html per rec + sessions/<tag>.html
  per transcript) into a batch_dir. Use once the user has finished analyzing
  every transcript of interest — a batch of one transcript is valid input too.
  Never driven by analyze-agent-transcript.
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
        "priority": "critical | high | medium | low",
        "bucket": "prompting | skills | mcp",
        "action": "create | modify | delete | adopt | stop",
        "problem":        "<the failure / issue, stated as the headline — what went wrong, in plain language>",
        "recommendation": "<the proposed fix — may be revised by review>",
        "rationale":      "<the leap: how the findings imply this recommendation>",
        "sources":        ["<finding id>", "..."],
        "inspiring_segments": [
          {
            "transcript_id": "<transcript_id from segments.json>",
            "segment_id":    "<S0.X>",
            "summary":       "<one short sentence — what happened here, plain language>",
            "before_evidence": [
              { "event_id": "<id from transcript.json>", "snippet": "<short raw quote / tool name / outcome>" }
            ],
            "after_evidence": [
              { "snippet": "<what this same moment would look like with the fix in place — short, abbreviated>" }
            ]
          }
        ]
      }
    ]
  }
  ```

  The schema is deliberately tight: **headline first** is the `problem`, not the fix — readers should see what went wrong before they see what to do about it. Plenty of recommendations get revised at the review step; problem statements rarely do.

  `priority` is fixed semantics, not vibes:
  - **critical** — the underlying problem **recurs across multiple instances** (segments / transcripts) AND each instance was high-impact. Two High-priority recs that instantiate the same cross-transcript pattern can both be Critical.
  - **high** — the problem **impacted overall Success vs Failure** on its own — a Failure the agent couldn't self-recover from, or a Correction the agent couldn't shake.
  - **medium** — a Segment hit Failure but the **agent (or a subagent) self-corrected** without user intervention. The system worked, even if it cost some turns.
  - **low** — cost / efficiency / clarity optimization. **Not a capability gap.** The agent succeeded; this would have made it cheaper or sharper.

  `sources` is the auditable trace: phase-3 finding ids the recommendation was synthesized from. A `source` id may come from any transcript in the batch (or from `findings.cross-transcript.json`).

  `inspiring_segments` is the **reader's bridge into the actual work** behind the recommendation — usually 1–3 entries (more for cross-transcript clusters). Each entry names a real Segment in a transcript's `segments.json` and carries:
  - a one-sentence `summary` of what happened in that Segment, plain language
  - a `before_evidence` chain — the 3–6 raw events (`event_id` + short `snippet`) from `transcript.json` that show the problem actually playing out
  - an `after_evidence` chain — the same moment, *abbreviated*, as it would have looked with the recommendation already in place (a hypothetical-but-grounded counterfactual: same `event_id`s where they still apply, new `snippet`s elsewhere)

  Both chains are kept short and concrete — the HTML companion renders them collapsed by default. The two chains together replace what used to be prose `change_contours` / `expected_after_state` fields: a reader who wants to inspect a recommendation reads the problem, then the recommendation, then expands the before/after chains for one or two inspiring segments. No long-form description needed; the events speak.

  Fields that used to exist and were removed: `title` (replaced by `problem`), `effort` (estimates were noise — drop), `philosophy_check` (philosophy is now an under-the-hood **gate**, not a surfaced field — see Sequencing checklist).

- **`report.md`** — the **human-readable final report**. Structure (grouped by **priority** — the lens that matters most — not by bucket; bucket appears as a small label on each rec):

  ```
  # Recommendations — <N> rec(s) over <M> transcript(s)

  ## Critical
    ### <problem headline> — <bucket> · <action> — sources: <linked finding ids>
      <recommendation: 1–2 sentences>
      <→ link to recommendation detail page (inspiring segments + before/after evidence chains)>
  ## High
    ### <problem headline> — <bucket> · <action> — sources: …
  ## Medium
    ### <problem headline> — <bucket> · <action> — sources: …
  ## Low
    ### <problem headline> — <bucket> · <action> — sources: …

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
    fed this report; whether findings.cross-transcript.json was present;
    which recommendations were **dropped at the philosophy gate** (one line each,
    with the rule that fired).
  ```

  **Everything that can be a link, is a link.** PR / issue / commit / docs URLs link to the external resource (sourced from `external-context.json`); finding ids and `inspiring_segments` segment ids link to the matching pages in the HTML companion. The reader should not be re-typing a PR number into GitHub or grepping `segments.json` for `S0.7` — every reference is one click.

- **`report.html`** + companion pages — a **multi-page static site** (not a single SPA) written into `batch_dir`:

  ```
  batch_dir/
    report.html                      # landing — recs grouped by priority, terse
    recommendations/rec-<NNN>.html   # one per recommendation — detail page
    sessions/<short-tag>.html        # one per transcript — detail page
  ```

  Each file is a small standalone HTML page with relative-href links to the others. No CDN, no build step; opening `report.html` from the filesystem (or via `python3 -m http.server` in `batch_dir` if the browser blocks `file://` cross-page navigation) gives the reader a navigable site. Pages cross-link freely: every `rec-NNN` chip on the landing page is a real `<a href="recommendations/rec-NNN.html">`; every `(S1, e2cdbb98)` or segment id is a real link to that session's page (with the segment anchored). Each recommendation page renders the `problem` headline, the `recommendation`, the `inspiring_segments` cards (each card has the `before_evidence` / `after_evidence` chains as collapsible `<details>` blocks). Each session page renders the session header, an inline flamegraph from `segments.json`, the segment tree (collapsible), and event play-by-play per segment (collapsed by default). Keep the visual chrome quiet — terse text, sparse badges, raw evidence over decoration.

  Round-trip rule: `findings.report.json` is source of truth; `report.md` is the canonical text artifact; the HTML pages are the rich-format reader-friendly view. All three carry the same recommendations — if they disagree, JSON wins and the others re-render.

## One report, over the batch

`synthesize-report` is **single-mode**: it always synthesizes "the batch." It is given the list of per-transcript `tmp_dir`s that make up the batch, reads every transcript's findings (plus `findings.cross-transcript.json` when present), and produces the **one final report** — the prioritized, deduped slate of action items across the three buckets. This single report is the pipeline's final output. A batch of one transcript is valid input — but there is no distinct "single-transcript mode," and the orchestrator never drives this skill.

## Sequencing checklist

- [ ] Resolve `batch_dir` (create a new tmp dir for the batch if none was given). Take the list of per-transcript `tmp_dir`s that make up the batch
- [ ] In each transcript's `tmp_dir`, discover the findings files. For each bucket, prefer `findings.<kind>.reviewed.json` over `findings.<kind>.json`. Record which you used per transcript — it goes in the report's Provenance section
- [ ] Check `batch_dir` for `findings.cross-transcript.json` (preferring `findings.cross-transcript.reviewed.json`). If present, read it as one more findings source; if absent, proceed without it
- [ ] Read every finding across every transcript. Drop items stamped `review.verdict == "rejected"` — a human already threw them out
- [ ] **Synthesize, don't restate.** Cluster findings that point at the same change — across transcripts, not just within one. A recommendation usually draws on several findings. Each recommendation gets a `sources` list naming the finding ids it came from
- [ ] **Route into three buckets.** `outcomes` findings carry a `recommendation_route` — follow it. `prompts` findings feed Prompting; `skills` feed Skills; `mcp` feed MCP. No cross-bucket invention
- [ ] **Philosophy gate — drop, don't surface.** Before a recommendation ships, cross-check it against `philosophy-on-skills` and `philosophy-on-mcp`. A rec that **contradicts the philosophy is dropped** — the philosophy docs already say what the right shape is (Skills are for judgment-bearing guidance; deterministic capabilities belong in MCP; hard-rule-on-every-event lives in hooks / CI checks but **those are not a recommendation type at this stage**). If the dropped rec's underlying problem can be cleanly rerouted to a different bucket within `prompting | skills | mcp` (e.g. a deterministic-config Skill recommendation reroutable to a CLAUDE.md prompting nudge), reroute it; otherwise drop and record in the Provenance section with the rule that fired. **The philosophy check is a gate, not a surfaced field** — no `philosophy_check` field exists on `findings.report.json` items
- [ ] **Prioritize per the four-level semantics.** Walk the new `priority` definitions in the Outputs section. `critical` requires the underlying problem to recur across multiple instances *and* each instance to have been high-impact; `high` is a Failure the agent couldn't self-recover from; `medium` is a Failure the agent self-corrected; `low` is cost / efficiency / clarity. Do not estimate effort — `effort` is not a field
- [ ] **Dedupe.** The same Skill gap surfacing in five Segments across three transcripts is one recommendation with five `sources`, not five recommendations
- [ ] **Populate `inspiring_segments` on every recommendation, with before/after evidence chains.** Pick 1–3 Segments (more for cross-transcript clusters) whose findings most directly motivated this recommendation; for each, write a short `summary` of what happened (per the Context-rebuild rule), then a `before_evidence` chain (3–6 real events from `transcript.json` showing the problem playing out — each as `{event_id, snippet}`) and an `after_evidence` chain (the same 3–6 moments, *abbreviated*, as they would look with the recommendation already in place — same `event_id`s where they still apply, new `snippet`s elsewhere). These chains replace long-prose explanation: a reader expands the chains and sees the actual events that justify the rec
- [ ] Compute the **distance-from-ideal** block by aggregating across the batch. Failure counts, Correction triggers (split user-source vs agent-source), wall-clock totals, and deterministic-trigger candidates come from each transcript's `segments.json` (prefer `segments.reviewed.json`). The human-counterfactual sum does **not** — `human_counterfactual_s` lives in the efficiency findings of each transcript's `findings.outcomes.json`; pull it from there. Sum only **root-segment-level** counterfactuals: a child segment's counterfactual rolls up into its parent, so summing every segment double-counts. Sum each quantity over every transcript. If a transcript is missing `segments.json`, note that transcript's omission rather than failing
- [ ] Write `findings.report.json` (the `{kind: "report", items: […]}` envelope) and `report.md` into `batch_dir`. Write the HTML companion as a **multi-page static site** also under `batch_dir`: `report.html` (landing) + `recommendations/rec-NNN.html` per recommendation + `sessions/<short-tag>.html` per transcript. All artifacts carry the same recommendations; if a discrepancy ever exists `findings.report.json` is source of truth. Print all paths to stdout
- [ ] **Hyperlink every reference, everywhere.** In `report.md` and the HTML site: PR / issue / commit / docs URLs (from `external-context.json`) link externally; recommendation ids link to `recommendations/rec-NNN.html`; transcript ids and segment ids link to `sessions/<short-tag>.html` (segment ids anchored within that page); finding ids open inline detail on the rec page. References like `(S2, ee234e49)` or `S0.7` in prose are real links — the reader should not have to copy a PR number into GitHub or grep `segments.json` for `S0.7`
- [ ] Point the user at `review-report` — the leap from findings to recommendations is interpretive and earns a human checkpoint, the same way phase 2 and phase 3 do

## Out of scope

- Producing the findings — that's the phase-3 analyzers (`analyze-*`), driven per transcript by `analyze-agent-transcript`, plus `analyze-cross-transcript-patterns` for the optional `findings.cross-transcript.json`.
- Deciding the batch is complete — the user signals that (no more transcripts of interest). This skill runs once that has happened.
- Human review of the report — that's `review-report`, the phase-4 checkpoint over `findings.report.json` in `batch_dir`.
- Turning review corrections into improvements — that's `learn-from-report-corrections`.
- Re-deriving anything from `transcript.json` or raw JSONL. This skill reads phase-3 findings (and `segments.json` only for the north-star counts). If a finding is wrong, fix the analyzer that drafted it — don't patch around it here.

## Notes

- **The leap is the product.** Phase 3 is deliberately conservative — it labels and stops. The value this skill adds is the synthesis: clustering across the whole batch, routing, prioritizing, and the explicit `rationale` + `sources` + `inspiring_segments` (with before/after evidence chains) that together make each leap inspectable.
- **Context-rebuild rule.** Write every `problem`, `recommendation`, `rationale`, and `inspiring_segments[*].summary` assuming the reader has **no memory of the session**. The session is a specific incident the reader hasn't seen and won't remember a week later. Recreate the necessary context inline — name the Skill or tool by its actual name (in backticks), say which kind of failure happened, name the user-visible symptom — so the recommendation is understandable on its own. Use **short sentences**; raw evidence over decoration; if a sentence is over two clauses, split it. `inspiring_segments[*].summary` is the cheapest place to ground: one short sentence per Segment, plain language, no jargon. Heavy lifting goes into the `before_evidence` / `after_evidence` chains, which are real events — they speak louder than prose.
- **Reviewed input beats draft input.** Always prefer `findings.<kind>.reviewed.json`. A report synthesized from human-blessed findings needs less correction than one synthesized from raw drafts.
- **Same envelope as phase 3, on purpose.** `findings.report.json` is `{kind, items}` so the review subsystem (`review.py` + `review_server.py` + `review_ui.html`) reviews it unchanged — `review-report` is a thin wrapper, not a new UI.
- **Privacy.** The findings this reads were synthesized from already-redacted Segments upstream (phase 1 redacts at acquire time). This skill writes `findings.report.json` and `report.md` as-is — no redaction pass here.
