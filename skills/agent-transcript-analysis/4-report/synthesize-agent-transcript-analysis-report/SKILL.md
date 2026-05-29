---
name: synthesize-agent-transcript-analysis-report
description: >
  Phase-4 synthesis — runs once over a whole batch of analyzed transcripts.
  Given the per-transcript tmp_dirs that make up the batch, reads every
  transcript's phase-3 findings (findings.outcomes/prompts/skills/mcp.json) plus
  findings.cross-transcript.json when present, and synthesizes them into ONE
  final report of actionable next steps across three buckets: human prompting,
  Skills (create/modify/delete), and MCP servers (create/modify/delete). Writes
  findings.report.json (the reviewable recommendation slate) and report.md (the
  human-readable report grouped by priority, including a key-stats block
  aggregated across the batch), and a multi-page HTML site
  (report.html landing + recommendations/rec-NNN.html per rec + sessions/<tag>.html
  per transcript) into a batch_dir. Use once the user has finished analyzing
  every transcript of interest — a batch of one transcript is valid input too.
  Never driven by analyze-agent-transcript.
user-invocable: true
---

# Synthesize report

Phase 3 produces **labels** — flat lists of conclusions about Outcomes, Prompts, Skills, and MCP servers, one set per transcript. This skill produces the **synthesis**: it reads the whole batch's findings and turns them into a prioritized, deduped slate of actionable next steps a human can act on — open a PR, rewrite a prompting habit, file an issue.

This is the one place the pipeline makes the **leap from analysis to recommendations**, and it makes it **once, over the whole batch** — not per transcript. A finding says "this Skill fired on a Segment it had no business firing on"; a recommendation says "narrow `analyze-skill-X`'s description — here's the change, here's the priority, here are the findings that motivate it." Phase 3 never makes that leap; phase 4 does, once, in one place, so the leap itself is auditable against the findings each recommendation cites.

`synthesize-agent-transcript-analysis-report` runs **after the batch is complete** — once the user has analyzed every transcript of interest. It is never invoked by `analyze-agent-transcript`; the orchestrator stops at per-transcript findings and has nothing to do with the report.

## Inputs

- `transcripts` (required): the list of per-transcript `tmp_dir`s that make up the batch — each one a folder `analyze-agent-transcript` ran over. From each, this skill reads the phase-3 findings set: `findings.outcomes.json`, `findings.prompts.json`, `findings.skills.json`, `findings.mcp.json`. A batch of one `tmp_dir` is valid; it is still "the batch," not a distinct single-transcript mode. Every findings item carries `id` (unique within its file), `segment_id`, `analyzer`, plus analyzer-specific fields, in the shared `{kind, items: […]}` envelope; evidence references are OpenTranscripts event ids, never integer turn indices. Item id schemes may diverge across transcripts (different orchestrator runs number differently) — that's fine, the synthesis stage doesn't surface finding ids in the report anyway (recommendations cite real Segments + raw event evidence chains, not finding-id lists).
- `batch_dir` (optional): a batch-level working directory, distinct from any single transcript's `tmp_dir`. The report artifacts are written here. Defaults to a new tmp dir created for the batch.
- `findings.cross-transcript.json` (optional): when `analyze-cross-agent-transcript-patterns` has been run over the batch, it lands in `batch_dir` — read it alongside the per-transcript findings. Absent is fine: the report simply has no cross-transcript findings folded in.
- `segments.json` (optional, in each transcript's `tmp_dir`): the Segment tree, used for the key-stats block (segment count, goal achievement rates, time-between-prompts), and as the structural source for the HTML companion's session pages and inline flamegraphs. If a transcript is missing `segments.json`, note the omission for that transcript rather than failing.
- `external_context` (optional, in each transcript's `tmp_dir`): `external-context.json`. The ticket / PR / user context behind a session — used to judge whether a recommendation is worth the user's time given what they were actually trying to do.
- `philosophy_skills` / `philosophy_mcp` (optional): the `philosophy-on-skills` and `philosophy-on-mcp` references. Default to the bundled copies. Every Skill/MCP recommendation is cross-checked against them before it lands in the report.

## Outputs

Two files written into `batch_dir`:

- **`findings.report.json`** — the **recommendation slate**. Same envelope as every phase-3 findings file (`{kind, items: [{id, …}]}`) with `kind: "report"`, keeping every artifact in the pipeline shaped the same way. Each item is one recommendation:

  ```json
  {
    "kind": "report",
    "items": [
      {
        "id": "rec-001",
        "priority": "critical | high | medium | low",
        "bucket": "prompting | skills | mcp",
        "action": "create | modify | delete | adopt | stop",
        "subject":        "<the named artifact the rec is about — e.g. `wait-for-ci` (Skill name), `agent-orchestrator` (MCP server name), `get_configs` (MCP tool name), or a short topic label for prompting recs>",
        "problem":        "<the failure / issue, stated as the headline — what went wrong, in plain language>",
        "recommendation": "<the proposed fix — may be revised by review>",
        "rationale":      "<the leap: how the findings imply this recommendation>",
        "proposed_change": {
          "kind":   "diff | draft",
          "format": "unified-diff | skill-md | mcp-json | prompt-snippet",
          "body":   "<short, digestible sketch — a unified diff for `modify` actions; a draft (Skill SKILL.md frontmatter + first sections, or mcp.json entry + proposed tool surface) for `create` actions. 10–40 lines, intentionally not exhaustive — the real change covers more edge cases.>"
        },
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

  The schema is deliberately tight: **headline first** is the `problem`, not the fix — readers should see what went wrong before they see what to do about it. Plenty of recommendations get revised at the review step; problem statements rarely do. `subject` is the **named artifact** the rec is about (the Skill name, the MCP server name, the MCP tool name, or a short prompt-habit topic), so the reader knows the scope of the rec at a glance — without it, "modify wait-for-ci" reads the same as "modify ao-router-route-request" until you've read three paragraphs.

  `priority` is fixed semantics, not vibes:
  - **critical** — the underlying problem **recurs across multiple instances** (segments / transcripts) AND each instance was high-impact. Two High-priority recs that instantiate the same cross-transcript pattern can both be Critical.
  - **high** — the problem **impacted overall Success vs Failure** on its own — a Failure the agent couldn't self-recover from, or a Correction the agent couldn't shake.
  - **medium** — a Segment hit Failure but the **agent (or a subagent) self-corrected** without user intervention. The system worked, even if it cost some turns.
  - **low** — cost / efficiency / clarity optimization. **Not a capability gap.** The agent succeeded; this would have made it cheaper or sharper.

  `inspiring_segments` is the **reader's bridge into the actual work** behind the recommendation AND the auditable trace of where the rec came from — usually 1–3 entries (more for cross-transcript clusters). The previous schema's `sources` field (a flat list of phase-3 finding ids) has been removed: a list of `fh-S0.7` / `mcpg-S0.3` ids is unverifiable noise to a reader, while a Segment + an evidence chain of real events *is* the verification. Each entry names a real Segment in a transcript's `segments.json` and carries:
  - a one-sentence `summary` of what happened in that Segment, plain language
  - a `before_evidence` chain — the 3–6 raw events (`event_id` + short `snippet`) from `transcript.json` that show the problem actually playing out
  - an `after_evidence` chain — the same moment, *abbreviated*, as it would have looked with the recommendation already in place (a hypothetical-but-grounded counterfactual: same `event_id`s where they still apply, new `snippet`s elsewhere)

  Both chains are kept short and concrete — the HTML companion renders them collapsed by default. The two chains together replace what used to be prose `change_contours` / `expected_after_state` fields: a reader who wants to inspect a recommendation reads the problem, then the recommendation, then expands the before/after chains for one or two inspiring segments. No long-form description needed; the events speak.

  `proposed_change` is **the rec's concrete starting point**. For a `modify` action: a short unified diff on the artifact's actual source (Skill `SKILL.md`, mcp.json, etc.). For a `create` action: a short draft of what the new artifact would look like (Skill frontmatter + first body sections; or an `mcp.json` entry + a sketched tool surface). Intentionally short — 10 to 40 lines — because the real change will cover more edge cases the synthesizer can't see. The point is to make the recommendation acceptable-or-rejectable in one read, not to spec the implementation.

  Fields that used to exist and were removed: `title` (replaced by `problem`), `effort` (estimates were noise — drop), `philosophy_check` (philosophy is now an under-the-hood **gate**, not a surfaced field — see Sequencing checklist), `sources` (replaced by `inspiring_segments` with real evidence chains — finding-id lists were unverifiable noise to a reader).

- **`report.md`** — the **human-readable final report**. Structure (grouped by **priority** — the lens that matters most — not by bucket; bucket appears as a small label on each rec):

  ```
  # Recommendations — <N> rec(s) over <M> transcript(s)

  ## Critical
    ### <problem headline> — `<subject>` · <bucket> · <action>
      <recommendation: 1–2 sentences>
      <→ link to recommendation detail page (inspiring segments + before/after evidence chains)>
  ## High
    ### <problem headline> — `<subject>` · <bucket> · <action>
  ## Medium
    ### <problem headline> — `<subject>` · <bucket> · <action>
  ## Low
    ### <problem headline> — `<subject>` · <bucket> · <action>

  ## Key stats
    Seven numbers, aggregated across the whole batch. Render times in
    `report.md` and the HTML companion using a humanized format:
    < 60 s ⇒ `<N>s`; ≥ 60 s ⇒ `<M>m<SS>s`. `findings.report.json` stores
    raw seconds (ints).
    - **transcripts_analyzed**: number of transcripts in the batch.
    - **transcript_segments**: total Segments across every transcript's
      segments.json (count nodes in the tree).
    - **goals_achieved_without_intervention_pct**: of all Segments, the
      percentage whose `outcome.kind == "Success"` AND whose subtree
      contains no user-source Correction trigger. Agent-source Corrections
      do not disqualify.
    - **goals_achieved_overall_pct**: of all Segments, the percentage
      whose `outcome.kind == "Success"`. Always ≥
      `goals_achieved_without_intervention_pct`.
    - **total_interventions**: count of Segments across the batch whose
      `trigger.kind == "Correction" AND trigger.source == "user"`. The
      raw count of times the user had to step in.
    - **median_active_time_between_prompts_s** and
      **max_active_time_between_prompts_s**: for each consecutive pair of
      UserMessage events (across all transcripts), active_time = (ts of
      the last non-UserMessage event before the next UserMessage) − (ts
      of the current UserMessage). Wall-time minus user think-time.
  ```

  The `report.md` carries **no `## Provenance` block** and **no closing CLI-style "next step" pointer**. Provenance is metadata about *the report's construction* (which findings draft was used, what was dropped at the philosophy gate, etc.) and reads as bookkeeping noise to the actual reader; if a downstream consumer needs that metadata, it lives in `findings.report.json` (the source of truth) where it belongs. A closing CLI hint doesn't earn its slot on a navigable report page.

  **Everything that can be a link, is a link.** PR / issue / commit / docs URLs link to the external resource (sourced from `external-context.json`); finding ids and `inspiring_segments` segment ids link to the matching pages in the HTML companion. The reader should not be re-typing a PR number into GitHub or grepping `segments.json` for `S0.7` — every reference is one click.

- **`report.html`** + companion pages — a **multi-page static site** (not a single SPA) written into `batch_dir`:

  ```
  batch_dir/
    report.html                      # landing — recs grouped by priority, terse
    recommendations/rec-<NNN>.html   # one per recommendation — detail page
    sessions/<short-tag>.html        # one per transcript — detail page
  ```

  Each file is a small standalone HTML page with relative-href links to the others. No CDN, no build step; opening `report.html` from the filesystem (or via `python3 -m http.server` in `batch_dir` if the browser blocks `file://` cross-page navigation) gives the reader a navigable site. Pages cross-link freely: every `rec-NNN` chip on the landing page is a real `<a href="recommendations/rec-NNN.html">`; every `(S1, e2cdbb98)` or segment id is a real link to that session's page (with the segment anchored).

  **Each recommendation page** renders, in this order:
  1. **The `subject` badge** + a **type badge** next to it carrying `<bucket> · <action>` (e.g. `Skill · modify`, `MCP · create`). Two badges, side by side, both load-bearing. The reader knows at a glance: "this is about `agent-orchestrator`; it's an MCP modify." Bucket is rendered in a Skill / MCP / Prompting word, not the raw enum value.
  2. The `problem` as the page title (h1), with a small priority text-label and the meta line below.
  3. The `recommendation` paragraph.
  4. **The `proposed_change`** as a syntax-highlighted code block — a unified diff for `modify` actions, a draft for `create` actions. This is concrete starting material, not decoration: the reader either accepts the sketch, edits it inline, or rejects it.
  5. The `rationale`.
  6. **Inspiring transcript moments**: one card per `inspiring_segments[*]`. Each card has the segment summary up top, then two `<details>` blocks (collapsed by default) for the `before_evidence` and `after_evidence` chains.
  7. **A pre-filled follow-up prompt** at the bottom of the page with a "Copy to clipboard" button. Text template: `"I have a follow-up question about <rec_id> (<problem>) that came from <transcript_id> segment(s) <segment_id_list>. <cursor>"`. The helper text next to the button points the reader at the **originating Claude Code session** — the session that ran `synthesize-agent-transcript-analysis-report` and produced this artifact (e.g. `"Paste into Claude Code session <session_id> (which generated this report) to keep digging"`). That session has the warm context — the segments, the findings, the philosophy gate decisions — so the follow-up lands somewhere that can already answer it. The synthesizer records its own session id at build time and embeds it. JS is allowed here and only here (vanilla `navigator.clipboard.writeText`); the rest of the site stays JS-free.

  **Each session page** renders the session header, an inline flamegraph from `segments.json`, the segment tree (collapsible), and event play-by-play per segment (collapsed by default).

  **Flamegraph layout rule.** The inline flamegraph must place every Segment at its **tree depth** on the Y axis (root at depth 0, root's children at depth 1, grandchildren at depth 2, …) and over its **actual `meta.event_range` time window** on the X axis. So a Segment like `S0.5.5` sits at depth 2, horizontally inside `S0.5`'s time window (which itself sits at depth 1, inside `S0`'s window at depth 0). A subagent or grandchild Segment can never visually appear "under" a sibling of its parent — its X position is governed by its real timestamps, and its Y row is governed by its tree depth. (Bugs in earlier implementations rendered descendants in sibling rows because Y was assigned by traversal order instead of by depth. Don't.)

  **Flamegraph width rule.** Compute width so smaller Segments stay readable rather than smushed: aim for a **minimum of ~2.5 px per second** of session wall-clock, and let the flamegraph scroll horizontally inside a `overflow-x: auto` container when that pushes it past the viewport. A long session (say 38 min ≈ 2280 s) renders ~5700 px wide; the reader scrolls. Smushing a 38-minute session into a single 600 px panel hides the sub-second sibling structure the reader needs to see — scroll beats smush.

  **Click targets get highlighted on the destination page.** When the reader clicks a `before_evidence` event link and lands on the session page at `#evt-<uuid>`, that event must be visibly highlighted (browser's `:target` pseudo-class with a clear background tint is sufficient — no JS needed). Same for segment anchors (`#seg-S0.7`): clicking a segment reference must land the reader visibly on the segment, not just at it. The whole point of evidence-link drill-down is verifiability; if a click teleports the reader to a wall of text without telling them what they were just citing, the trust never builds.

  **Pretty, not noisy.** The visual chrome the user objected to last round (stats cards at the top, batch-report preamble, decorative priority pills, tentative chips, bucket pills, philosophy-check writeups, sources lists) stays gone. But proper styling stays: system font stack, comfortable line-height, max-width on prose, card layouts with subtle borders for distinct content blocks, monospace for event ids / code / tool names, priority shown as a small colored text label (not a chip), outcome colors confined to text on `<summary>` lines for the segment tree. Quiet palette in light + dark. Raw evidence over decoration is the rule; *no decoration at all* was the over-correction.

  Round-trip rule: `findings.report.json` is source of truth; `report.md` is the canonical text artifact; the HTML pages are the rich-format reader-friendly view. All three carry the same recommendations — if they disagree, JSON wins and the others re-render.

## One report, over the batch

`synthesize-agent-transcript-analysis-report` is **single-mode**: it always synthesizes "the batch." It is given the list of per-transcript `tmp_dir`s that make up the batch, reads every transcript's findings (plus `findings.cross-transcript.json` when present), and produces the **one final report** — the prioritized, deduped slate of action items across the three buckets. This single report is the pipeline's final output. A batch of one transcript is valid input — but there is no distinct "single-transcript mode," and the orchestrator never drives this skill.

## Sequencing checklist

- [ ] Resolve `batch_dir` (create a new tmp dir for the batch if none was given). Take the list of per-transcript `tmp_dir`s that make up the batch
- [ ] In each transcript's `tmp_dir`, discover the findings files: `findings.outcomes.json`, `findings.prompts.json`, `findings.skills.json`, `findings.mcp.json`
- [ ] Check `batch_dir` for `findings.cross-transcript.json`. If present, read it as one more findings source; if absent, proceed without it
- [ ] Read every finding across every transcript
- [ ] **Synthesize, don't restate.** Cluster findings that point at the same change — across transcripts, not just within one. A recommendation usually draws on several findings. Pick the Segments those findings cited; those Segments become this rec's `inspiring_segments`
- [ ] **Route into three buckets.** `outcomes` findings carry a `recommendation_route` — follow it. `prompts` findings feed Prompting; `skills` feed Skills; `mcp` feed MCP. No cross-bucket invention
- [ ] **Philosophy gate — drop, don't surface.** Before a recommendation ships, cross-check it against `philosophy-on-skills` and `philosophy-on-mcp`. A rec that **contradicts the philosophy is dropped** — the philosophy docs already say what the right shape is (Skills are for judgment-bearing guidance; deterministic capabilities belong in MCP; hard-rule-on-every-event lives in hooks / CI checks but **those are not a recommendation type at this stage**). If the dropped rec's underlying problem can be cleanly rerouted to a different bucket within `prompting | skills | mcp` (e.g. a deterministic-config Skill recommendation reroutable to a CLAUDE.md prompting nudge), reroute it; otherwise drop it. **The philosophy check is a gate, not a surfaced field** — no `philosophy_check` field exists on `findings.report.json` items
- [ ] **Prioritize per the four-level semantics.** Walk the new `priority` definitions in the Outputs section. `critical` requires the underlying problem to recur across multiple instances *and* each instance to have been high-impact; `high` is a Failure the agent couldn't self-recover from; `medium` is a Failure the agent self-corrected; `low` is cost / efficiency / clarity. Do not estimate effort — `effort` is not a field
- [ ] **Dedupe.** The same Skill gap surfacing in five Segments across three transcripts is one recommendation with five `inspiring_segments`, not five recommendations
- [ ] **Populate `inspiring_segments` on every recommendation, with before/after evidence chains.** Pick 1–3 Segments (more for cross-transcript clusters) whose findings most directly motivated this recommendation; for each, write a short `summary` of what happened (per the Context-rebuild rule), then a `before_evidence` chain (3–6 real events from `transcript.json` showing the problem playing out — each as `{event_id, snippet}`) and an `after_evidence` chain (the same 3–6 moments, *abbreviated*, as they would look with the recommendation already in place — same `event_id`s where they still apply, new `snippet`s elsewhere). These chains replace long-prose explanation: a reader expands the chains and sees the actual events that justify the rec
- [ ] Compute the **key stats** block by aggregating across the batch:
  - `transcripts_analyzed` — number of transcripts in the batch (literal count).
  - `transcript_segments` — count every Segment node across every transcript's `segments.json` (recurse the tree).
  - `goals_achieved_without_intervention_pct` — for each Segment, classify "without intervention" as: `outcome.kind == "Success"` AND (recursively) no descendant Segment has a `trigger.kind == "Correction" AND trigger.source == "user"`. Compute (count_without_intervention / total_segments) * 100.
  - `goals_achieved_overall_pct` — count Segments with `outcome.kind == "Success"`, divide by total, * 100. Always ≥ the previous number.
  - `total_interventions` — count of Segments with `trigger.kind == "Correction" AND trigger.source == "user"` across the batch. The raw count of times the user had to step in.
  - `median_active_time_between_prompts_s` / `max_active_time_between_prompts_s` — for each transcript, walk the projected events; for each `UserMessage` event, find the *next* `UserMessage` and compute `active_time = (ts of the LAST non-UserMessage event with ts < next_user_ts) − (current_user_ts)`. This is wall-time minus user think-time. Collect all such intervals across the batch, report the median and the max in **raw seconds (ints)** in JSON; render with humanized format (`<N>s` if < 60, `<M>m<SS>s` if ≥ 60) in `report.md` and HTML. If there's only one UserMessage in a transcript, it contributes nothing to either stat.
  - All seven fields are required; report `null` for the two time stats only if there are zero qualifying pairs in the whole batch
- [ ] Build a **`proposed_change`** for every recommendation: a short diff for `modify` actions (unified-diff format against the existing artifact's source), a short draft for `create` actions (Skill SKILL.md frontmatter + first sections, or mcp.json entry + sketched tool surface). 10–40 lines, intentionally not exhaustive. State this as a starting point a reviewer can amend, not as a final spec
- [ ] Write `findings.report.json` (the `{kind: "report", items: […]}` envelope) and `report.md` into `batch_dir`. Write the HTML companion as a **multi-page static site** also under `batch_dir`: `report.html` (landing) + `recommendations/rec-NNN.html` per recommendation + `sessions/<short-tag>.html` per transcript. All artifacts carry the same recommendations; if a discrepancy ever exists `findings.report.json` is source of truth. Print all paths to stdout
- [ ] **Hyperlink every reference, everywhere.** In `report.md` and the HTML site: PR / issue / commit / docs URLs (from `external-context.json`) link externally; recommendation ids link to `recommendations/rec-NNN.html`; transcript ids and segment ids link to `sessions/<short-tag>.html` (segment ids anchored within that page); finding ids open inline detail on the rec page. References like `(S2, ee234e49)` or `S0.7` in prose are real links — the reader should not have to copy a PR number into GitHub or grep `segments.json` for `S0.7`
- [ ] **Do not** end the report itself with a closing CLI-style "next step" pointer — that doesn't earn its slot on a navigable report page.

## Out of scope

- Producing the findings — that's the phase-3 analyzers (`analyze-*`), driven per transcript by `analyze-agent-transcript`, plus `analyze-cross-agent-transcript-patterns` for the optional `findings.cross-transcript.json`.
- Deciding the batch is complete — the user signals that (no more transcripts of interest). This skill runs once that has happened.
- Re-deriving anything from `transcript.json` or raw JSONL. This skill reads phase-3 findings (and `segments.json` only for the north-star counts). If a finding is wrong, fix the analyzer that drafted it — don't patch around it here.

## Notes

- **The leap is the product.** Phase 3 is deliberately conservative — it labels and stops. The value this skill adds is the synthesis: clustering across the whole batch, routing, prioritizing, and the explicit `problem` + `rationale` + `inspiring_segments` (with before/after evidence chains) that together make each leap inspectable.
- **Context-rebuild rule.** Write every `problem`, `recommendation`, `rationale`, and `inspiring_segments[*].summary` assuming the reader has **no memory of the session**. The session is a specific incident the reader hasn't seen and won't remember a week later. Recreate the necessary context inline — name the Skill or tool by its actual name (in backticks), say which kind of failure happened, name the user-visible symptom — so the recommendation is understandable on its own. Use **short sentences**; raw evidence over decoration; if a sentence is over two clauses, split it. `inspiring_segments[*].summary` is the cheapest place to ground: one short sentence per Segment, plain language, no jargon. Heavy lifting goes into the `before_evidence` / `after_evidence` chains, which are real events — they speak louder than prose.
- **Same envelope as phase 3, on purpose.** `findings.report.json` is `{kind, items}` with `kind: "report"`, keeping every artifact in the pipeline shaped the same way so tooling that reads one findings file reads them all.
- **Privacy.** The findings this reads were synthesized from already-redacted Segments upstream (phase 1 redacts at acquire time). This skill writes `findings.report.json` and `report.md` as-is — no redaction pass here.
