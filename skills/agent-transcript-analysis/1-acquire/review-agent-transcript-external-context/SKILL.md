---
name: review-agent-transcript-external-context
description: >
  Open a local browser UI to audit and correct the external-context.json
  drafted by gather-agent-transcript-external-context. Resolving the right ticket, PR, and
  user background is inferential — the gatherer can pull the wrong ticket,
  miss a PR, or leave a block unresolved — so its output is a draft a human
  should confirm. Every field is editable: fix a wrong ticket id, attach a
  PR the gatherer missed, correct role / team details, resolve what it could
  not. Saving writes external-context.reviewed.json next to the draft (the
  draft is never overwritten) with full correction provenance. Use after
  gather-agent-transcript-external-context and before decompose-agent-transcript-into-transcript-segments when
  you want human-blessed context. Optional but recommended.
user-invocable: true
---

# Review external context

`gather-agent-transcript-external-context` emits `external-context.json` — an **inferred draft**. Matching a transcript to its ticket, its PR, and the user's background means reading signals (branch names, URLs in messages, repo slugs) and guessing — and some of those guesses will be wrong.

This skill puts the draft in front of a human in an editable UI, and records every correction with enough provenance to see exactly where the gatherer went wrong.

This is the **review checkpoint** for the context bundle — the phase-1 counterpart to `review-agent-transcript-segments`. It is optional — downstream phases read `external-context.json` fine on its own — but a corrected bundle makes every later judgment better, and the corrections show where `gather-agent-transcript-external-context` could be improved.

## Inputs

- `tmp_dir` (required): a transcript tmp_dir containing `external-context.json` (or an existing `external-context.reviewed.json` to keep iterating). `transcript.json` should also be present — it powers the inference-evidence preview so the reviewer can see *why* the gatherer guessed what it did.

## Outputs

One file written into `tmp_dir`:

- **`external-context.reviewed.json`** — the human-blessed context bundle. **Same schema as `external-context.json`**, so every downstream reader consumes it transparently. It adds:
  - a `review: {edited, corrections}` block on every block the user touched
  - a root `review: {reviewed_at, reviewer, base, log}` block carrying file-level provenance and the full append-only correction log

`external-context.json` is **never modified** — the inferred draft is preserved so the gatherer-vs-human diff stays inspectable.

## Invocation

```
python main.py --tmp-dir /path/to/transcript-tmp-dir [--port 9851] [--no-browser]
```

`main.py` starts an HTTP server on `127.0.0.1:<port>` (default `9851`) and serves `ui.html`. Pass `--no-browser` to skip the auto-open on remote / headless hosts.

## Sequencing checklist

- [ ] Confirm `tmp_dir` contains `external-context.json` (or `external-context.reviewed.json`); if not, run `gather-agent-transcript-external-context` first
- [ ] Start the local UI (`python main.py --tmp-dir <tmp_dir>`, default `localhost:9851`)
- [ ] The user audits each block against its `how_found` evidence: is this the right ticket? the right PR? is the role / team correct?
- [ ] The user fixes what's wrong — correct a field, attach a ticket or PR the gatherer missed, clear a wrong block, resolve an `unresolved` entry — and adds a "why / context" note explaining each correction
- [ ] The user clicks **Save**, which writes `external-context.reviewed.json`
- [ ] Downstream skills (phases 2-5) prefer `external-context.reviewed.json` when it exists and fall back to `external-context.json`

## What the user can edit

- **Ticket** — `id`, `url`, `title`, `description`, `status`; clear the block entirely if the gatherer matched the wrong one.
- **Pull request** — `repo`, `number`, `url`, `state`, `diff_summary`; attach a PR the gatherer missed.
- **User context** — `role`, `team`, `project`, `tenure`.
- **Unresolved** — resolve an entry by filling in the block it refers to, or confirm it really is unavailable.
- **Confidence** — downgrade or confirm the gatherer's `confidence` on any block.
- **Context** — a free-text "why / context" note per correction.

## Out of scope

- Producing the draft — that's `gather-agent-transcript-external-context`.
- Acting on the corrections to improve `gather-agent-transcript-external-context` — surface that as a flagged opportunity for the user; this skill does not edit any skill, and there is no automated learn-from loop for context (yet).
- Any analysis or scoring — every `analyze-*` skill is downstream of this.

## Privacy

- Secret-redaction runs once, at acquire time: `gather-agent-transcript-external-context` redacts `external-context.json` as it writes it. The inference-evidence preview and `external-context.reviewed.json` are built from that already-redacted draft, so this skill writes them as-is — no second redaction pass.
- The localhost server has no public binding and no upload endpoint.
- `external-context.json` and `transcript.json` are never modified.
