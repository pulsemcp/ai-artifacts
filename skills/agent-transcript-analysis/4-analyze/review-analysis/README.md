# `review-analysis`

The human review checkpoint for tier 4. Opens a localhost UI to audit and correct an AI-drafted findings list, and writes a `findings.<kind>.reviewed.json` sibling with full correction provenance.

## Why this exists

Tier 1 (acquisition) is deterministic — no review UI needed. Tiers 2, 3, and 4 are all interpretive, and each interpretive step gets a review checkpoint: `review-external-context` for the gathered context, `review-transcript-segments` for the Segment tree, and **this skill for the analyzer findings**.

Every tier-4 analyzer emits conclusions — "this Segment failed because…", "this Skill was a false positive", "an MCP tool is missing here". Those are judgment calls, and a confident-but-wrong finding propagates straight into the final report. So `findings.<kind>.json` is treated as a **draft**: this skill is where a human turns it into findings they'd stand behind, and where their corrections get captured in a structured, replayable form so the analyzers can be improved.

## Files

| File | Role |
|---|---|
| `main.py` | Thin wrapper. `--tmp-dir` (required), `--kind` (required), `--port` (default 9852), `--no-browser`. Picks a `tmp_dir` + `kind` and calls `review_server.py`'s `serve()`. |
| `review_server.py` | The localhost HTTP server — loads a draft, serves the UI, handles save. |
| `review_ui.html` | The single static review UI, served by `review_server.py`. |
| `review.py` | The correction-provenance contract — load, validate, stamp, atomic-write. |
| `SKILL.md` | The skill contract. |

The server, the static UI, and the provenance contract are **bundled in this skill folder** (`review_server.py`, `review_ui.html`, `review.py`) and parametrised only by `kind` — so a new reviewable `kind` is a one-line change, not a new server and UI. They are self-contained copies: the skill carries everything it needs to run from a deployed `.claude/skills/review-analysis/` directory.

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
- **One engine, every bucket.** Findings are flat lists of independent items regardless of which analyzer produced them — so the server, UI, and provenance contract (`review_server.py`, `review_ui.html`, `review.py`) are bundled in this skill folder and parametrised only by `kind`. Contrast `review-transcript-segments`, whose subject is a recursive tree and so carries its own server and UI.
- **Self-contained, not DRY.** `review_server.py`, `review_ui.html`, and `review.py` are bundled copies, not a shared library import. A skill that runs from a deployed `.claude/skills/` copy can't reach a sibling's files, so each skill carries its own — portability beats deduplication here.
- **Per-item verdicts, not tree surgery.** A findings list has no structure to split or merge — you judge each conclusion independently. The contract is deliberately the simpler of the two review subsystems.
- **Warnings never block a save.** The validator checks the envelope (a `kind`, an `items` list, unique ids) but the reviewer can always save anyway.
- **Trust upstream redaction.** Secret-redaction runs once at acquire time (tier 1). The `findings.<kind>.json` drafts this skill reviews were built from already-redacted Segments, so the reviewed sibling is written as-is — no second redaction pass here.
