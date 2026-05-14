# `review-analysis`

The human review checkpoint for tier 4. Opens a localhost UI to audit and correct an AI-drafted findings list, and writes a `findings.<kind>.reviewed.json` sibling with full correction provenance.

## Why this exists

Tier 1 (acquisition) is deterministic — no review UI needed. Tiers 2, 3, and 4 are all interpretive, and each interpretive step gets a review checkpoint: `review-external-context` for the gathered context, `review-transcript-segments` for the Segment tree, and **this skill for the analyzer findings**.

Every tier-4 analyzer emits conclusions — "this Segment failed because…", "this Skill was a false positive", "an MCP tool is missing here". Those are judgment calls, and a confident-but-wrong finding propagates straight into the final report. So `findings.<kind>.json` is treated as a **draft**: this skill is where a human turns it into findings they'd stand behind, and where their corrections get captured in a structured, replayable form so the analyzers can be improved.

## Files

| File | Role |
|---|---|
| `main.py` | Thin wrapper. `--tmp-dir` (required), `--kind` (required), `--port` (default 9852), `--no-browser`. Picks a `tmp_dir` + `kind` and calls `_lib/review_server.py`'s `serve()`. |
| `SKILL.md` | The skill contract. |

The server, the static UI, and the provenance contract are **shared** and live in `_lib/` — `review_server.py`, `review_ui.html`, and `review.py` — not in this skill folder. A new reviewable `kind` is a one-line change, not a new server and UI.

## One engine, every findings bucket

`review-analysis` reviews any of the five findings buckets, picked by `--kind`:

| `--kind` | Draft file | Produced by |
|---|---|---|
| `outcomes` | `findings.outcomes.json` | `analyze-agent-transcript` |
| `prompts` | `findings.prompts.json` | `analyze-agent-transcript` |
| `skills` | `findings.skills.json` | `analyze-agent-transcript` |
| `mcp` | `findings.mcp.json` | `analyze-agent-transcript` |
| `cross-transcript` | `findings.cross-transcript.json` | `analyze-cross-transcript-patterns` |

## The reviewed sibling

```
tmp_dir/
  transcript.json                   # tier 1 output — never touched
  findings.skills.json              # analyzer draft — never touched
  findings.skills.reviewed.json     # written here; same schema + a `review` block
```

`findings.<kind>.reviewed.json` is schema-compatible with the draft (readers consume either), with two additions:

- every item carries `review: {verdict, corrections}` — `verdict` is `approved` / `corrected` / `rejected` / `unreviewed`
- the document additionally carries `review: {reviewed_at, reviewer, base, log, warnings}` — file-level provenance plus the full append-only correction log

## Correction log entry types

Every action appends one replayable entry to the log:

- `{type: "approve", item_id, at}` — thumbs-up; the finding is right.
- `{type: "field", item_id, field, before, after, note, at}` — one field of a finding was corrected.
- `{type: "reject", item_id, note, at}` — the whole finding is wrong.
- `{type: "note", item_id, note, at}` — a free-text "why / context" note.

The per-item `verdict` is derived from the log: a reject beats a correction beats an approval.

## Design decisions

- **The draft is immutable; the review is a sibling.** Keeping `findings.<kind>.json` pristine means the analyzer-vs-human diff is always inspectable, and a bad review can be thrown away by deleting one file.
- **One engine, every bucket.** Findings are flat lists of independent items regardless of which analyzer produced them — so the server, UI, and provenance contract are shared in `_lib/` and parametrised only by `kind`. Contrast `review-transcript-segments`, whose subject is a recursive tree and so carries its own server and UI.
- **Per-item verdicts, not tree surgery.** A findings list has no structure to split or merge — you judge each conclusion independently. The contract is deliberately the simpler of the two review subsystems.
- **Warnings never block a save.** The validator checks the envelope (a `kind`, an `items` list, unique ids) but the reviewer can always save anyway.
- **Redact on the way out.** Every string written to `findings.<kind>.reviewed.json` goes through `_lib/redaction.py`.
