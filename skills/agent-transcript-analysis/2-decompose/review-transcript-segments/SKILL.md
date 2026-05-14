---
name: review-transcript-segments
description: >
  Open a local browser UI to audit and correct the AI-drafted Transcript
  Segment tree (segments.json) produced by decompose-into-transcript-segments.
  Decomposition is the most interpretive step in the pipeline — where Goals
  change, whether a Segment was a Failure, what the Trigger was — so its
  output is a draft a human should review. Every field is editable; the user
  can split a leaf Segment, merge adjacent siblings, and attach context notes.
  Saving writes segments.reviewed.json next to the draft (the draft is never
  overwritten) with full correction provenance. Use this skill after
  decompose-into-transcript-segments and before any analyze-* skill when you
  want a human-blessed decomposition. Optional but recommended.
user-invocable: true
---

# Review transcript segments

`decompose-into-transcript-segments` emits `segments.json` — an **AI draft**. Decomposition is the most interpretive step in the whole pipeline: deciding where a Goal changes, whether a Segment was a Failure, and what its Trigger was are all judgment calls. This skill puts that draft in front of a human in an editable UI so they can correct it, and records every correction with enough provenance that [`learn-from-segment-corrections`](../learn-from-segment-corrections/SKILL.md) can feed the fixes back into the decompose skill.

This is the **review checkpoint** for tier 2. It is optional — analyzers read `segments.json` fine on their own — but every correction captured here makes the next decomposition better.

## Inputs

- `tmp_dir` (required): a transcript tmp_dir from `get-one-claude-code-transcript`. Must contain `segments.json` (or an existing `segments.reviewed.json` to keep iterating). `transcript.json` should also be present — it powers the event-preview index and lets the validator cross-check event ids.

## Outputs

One file written into `tmp_dir`:

- **`segments.reviewed.json`** — the human-blessed Segment tree. **Same schema as `segments.json`** (see [`references/open-transcripts/schemas/transcript-segment.md`](../../../../references/open-transcripts/schemas/transcript-segment.md), section "`segments.reviewed.json` — the reviewed sibling"), so every downstream analyzer reads it transparently. It adds:
  - a `review: {edited, corrections}` block on every Segment the user touched
  - a `review: {reviewed_at, reviewer, base, log, warnings}` block on the root Segment carrying file-level provenance and the full append-only correction log

`segments.json` is **never modified** — the AI draft is preserved so the diff against the human review stays inspectable.

## Invocation

```
python skills/agent-transcript-analysis/2-decompose/review-transcript-segments/main.py \
    --tmp-dir /path/to/transcript-tmp-dir [--port 9850] [--no-browser]
```

`main.py` starts an HTTP server on `127.0.0.1:<port>` (default `9850`) and serves `ui.html`. Pass `--no-browser` to skip the auto-open (useful on remote / headless hosts).

## Sequencing checklist

- [ ] Confirm `tmp_dir` contains `segments.json` (or `segments.reviewed.json`); if not, run `decompose-into-transcript-segments` first
- [ ] Start the local UI (`python main.py --tmp-dir <tmp_dir>`, default `localhost:9850`)
- [ ] The user audits the tree: every Trigger / Goal / Outcome field is editable; the event-preview index next to each Segment lets them sanity-check boundaries and evidence
- [ ] The user fixes what's wrong — edit fields, **Split** a leaf into sub-segments, **Merge ↓** a Segment into its next sibling, and add a **Why / context** note explaining each correction
- [ ] The user clicks **Save**, which writes `segments.reviewed.json` and surfaces any validation warnings (warnings never block a save — the reviewer's judgment wins)
- [ ] Downstream skills (tier 3/4) should now prefer `segments.reviewed.json` when it exists (the `_lib/segment_review.py` `load_bundle` helper does this automatically)

## What the user can edit

- **Trigger** — `kind` (New / Correction), `source` (user / agent / subagent), `event_id`, `text`. Flipping `source` to `agent` auto-nulls `event_id` and `text` per the schema.
- **Goal** — `text` and `kind` (Plan / Action).
- **Outcome** — `kind` (Success / Failure) and `evidence_event_ids` (add/remove against the event index).
- **Boundaries** — `meta.event_range` start/end, plus the rest of `meta` (wall-clock, tokens, model, source transcript id).
- **Structure** — **Split** a leaf Segment into two children; **Merge** a Segment with its next sibling.
- **Context** — a free-text "Why / context" note per Segment, saved alongside the corrections.

## How it works

1. `main.py` loads `segments.json` (or `segments.reviewed.json`) and builds a compact, **redacted** event index from `transcript.json` — `{id, type, ts, preview}` per event, never the full event bodies.
2. Serves a single static `ui.html` from a localhost HTTP server. No external requests, no CDN.
3. Every edit appends an entry to an in-memory **correction log** (`field` / `split` / `merge` / `note`). The log is append-only and replayable.
4. On Save, `POST /api/save` hands the edited tree + full log to `_lib/segment_review.py::write_reviewed`, which strips any stale `review` stamps, re-derives them from the log, validates the tree, attaches file-level provenance, redacts every string, and atomically writes `segments.reviewed.json`.

The correction-provenance contract lives in [`_lib/segment_review.py`](../../_lib/segment_review.py) and is shared with `learn-from-segment-corrections`.

## Out of scope

- Producing the draft — that's `decompose-into-transcript-segments`.
- Acting on the corrections to improve the decompose skill — that's the sibling skill `learn-from-segment-corrections`.
- Any analysis or recommendation — every `analyze-*` skill is downstream of this.

## Privacy

- The event index and every string in `segments.reviewed.json` are secret-redacted (`_lib/redaction.py`) before they reach the browser or disk.
- The localhost server has no public binding and no upload endpoint.
- `segments.json` and `transcript.json` are never modified.
