---
name: review-analysis
description: >
  Open a local browser UI to audit and correct the AI-drafted findings a
  tier-4 analyzer produced — findings.<kind>.json, one flat list of
  conclusions per bucket (outcomes, prompts, skills, mcp, cross-transcript).
  Every analyzer's output is a draft: thumbs-up the findings you agree with,
  correct the fields it got wrong, reject the ones that miss. Saving writes
  findings.<kind>.reviewed.json next to the draft (the draft is never
  overwritten) with full correction provenance. Use after the tier-4
  analyzers run (driven by analyze-agent-transcript, or by
  analyze-cross-transcript-patterns) and before learn-from-analysis-corrections.
  Optional but recommended human checkpoint for tier 4.
user-invocable: true
---

# Review analysis

The tier-4 analyzers turn a transcript into findings — flat lists of conclusions about Outcomes, Prompts, Skills, MCP servers, and cross-transcript patterns. Each list lands in `tmp_dir` as a `findings.<kind>.json` draft. Those conclusions are **judgment calls**: was this Segment really a Failure? was that Skill a false positive? is this proposed MCP tool actually missing? The analyzer will get some of them wrong.

This skill puts one bucket's draft in front of a human in an editable UI — one finding at a time, thumbs-up / correct / reject — and records every correction with enough provenance that `learn-from-analysis-corrections` can turn the fixes into flagged improvement opportunities for the analyzer that drafted them.

It is the **review checkpoint for tier 4**, the tier-4 counterpart to `review-transcript-segments` (tier 2) and `review-external-context` (tier 1). It is optional — `analyze-agent-transcript` consumes `findings.<kind>.json` fine on its own — but every correction captured here makes the next analysis better.

## Inputs

- `tmp_dir` (required): a transcript tmp_dir. Must contain a `findings.<kind>.json` (or an existing `findings.<kind>.reviewed.json` to keep iterating) for the bucket you want to review.
- `kind` (required): which findings bucket — one of `outcomes`, `prompts`, `skills`, `mcp`, `cross-transcript`. `analyze-agent-transcript` writes the first four; `analyze-cross-transcript-patterns` writes `cross-transcript`.

## The findings document

A `findings.<kind>.json` is a thin envelope the review subsystem is deliberately schema-agnostic about — each analyzer bucket fills its `items` with its own fields:

```
{
  "kind": "skills",
  "items": [
    { "id": "<unique>", ...analyzer-specific fields... },
    ...
  ]
}
```

The only guarantees the reviewer (and `_lib/review.py`) rely on: a `kind`, an `items` list, and a unique non-empty `id` on every item. Anything else is the analyzer's business — the UI renders each item's fields generically.

## Outputs

One file written into `tmp_dir`:

- **`findings.<kind>.reviewed.json`** — the human-blessed findings list. **Same schema as `findings.<kind>.json`**, so every downstream reader consumes it transparently (the `_lib/review.py` loader prefers the reviewed sibling). It adds:
  - a `review: {verdict, corrections}` block on every item — `verdict` is one of `approved` / `corrected` / `rejected` / `unreviewed`
  - a document-level `review: {reviewed_at, reviewer, base, log, warnings}` block carrying file-level provenance and the full append-only correction log

`findings.<kind>.json` is **never modified** — the AI draft is preserved so the analyzer-vs-human diff stays inspectable.

## Invocation

```
python main.py --tmp-dir /path/to/transcript-tmp-dir --kind skills [--port 9852] [--no-browser]
```

`main.py` is a thin wrapper over the shared review engine in `_lib/` — it picks a `tmp_dir` and a `kind` and calls `_lib/review_server.py::serve()`. The server binds `127.0.0.1:<port>` (default `9852`) and serves `_lib/review_ui.html`. Pass `--no-browser` to skip the auto-open on remote / headless hosts.

## Sequencing checklist

- [ ] Confirm `tmp_dir` contains `findings.<kind>.json` (or `findings.<kind>.reviewed.json`); if not, run the analyzers first — `analyze-agent-transcript` for `outcomes` / `prompts` / `skills` / `mcp`, `analyze-cross-transcript-patterns` for `cross-transcript`
- [ ] Start the local UI (`python main.py --tmp-dir <tmp_dir> --kind <kind>`, default `localhost:9852`)
- [ ] The user audits each finding: every scalar field is editable; complex (nested) fields are shown read-only
- [ ] For each finding the user **Approves** it (thumbs-up), **corrects** the fields that are wrong, or **Rejects** the whole finding — and can attach a "why / context" note explaining a rejection or a correction
- [ ] The user clicks **Save**, which writes `findings.<kind>.reviewed.json` and surfaces any envelope warnings (warnings never block a save — the reviewer's judgment wins)
- [ ] Downstream skills prefer `findings.<kind>.reviewed.json` when it exists (the `_lib/review.py` loader does this automatically)

## What the user can do per finding

- **Approve** — thumbs-up; the analyzer got this one right.
- **Correct a field** — edit any scalar field in place; the change is applied to the saved document and logged with `before` / `after`.
- **Reject** — the whole finding is wrong; it stays in the document, stamped `verdict: rejected`, so downstream readers skip it and the rejection stays visible.
- **Add a note** — a free-text "why / context" note, attached to a rejection or standing on its own.
- **Undo last** — drop the most recent unsaved action on a finding.

## How it works

1. `main.py` calls `serve(tmp_dir, kind)`. `_lib/review_server.py` loads the draft (or the reviewed sibling) via `_lib/review.py`'s `load_review_bundle`.
2. It serves the single static `_lib/review_ui.html` from a localhost HTTP server. No external requests, no CDN.
3. Every action appends an entry to an in-memory **correction log** — `approve` / `field` / `reject` / `note`. The log is append-only and replayable.
4. On Save, `POST /api/save` hands the edited document + full log to `_lib/review.py`'s `write_reviewed`, which strips any stale `review` stamps, re-derives them from the log, validates the envelope, attaches file-level provenance, redacts every string, and atomically writes `findings.<kind>.reviewed.json`.

The correction-provenance contract lives in `_lib/review.py` and is shared with `learn-from-analysis-corrections`. The server and UI in `_lib/` are shared across every findings bucket — a new reviewable `kind` needs no new code.

## Out of scope

- Producing the draft — that's the tier-4 analyzers, driven by `analyze-agent-transcript` (or `analyze-cross-transcript-patterns`).
- Turning the corrections into improvement opportunities for the analyzers — that's the sibling skill `learn-from-analysis-corrections`.
- Reviewing the Segment tree (tier 2) or the external-context bundle (tier 1) — those are `review-transcript-segments` and `review-external-context`.
- Synthesizing findings into a final recommendation slate — that's tier 5's job.

## Privacy

- Every string in `findings.<kind>.reviewed.json` is secret-redacted (`_lib/redaction.py`) before it touches disk; the drafts read here were already redacted at produce time.
- The localhost server has no public binding and no upload endpoint.
- `findings.<kind>.json` is never modified.
