# `review-transcript-segments`

The human review checkpoint for phase 2. Opens a localhost UI to audit and correct the AI-drafted Segment tree, and writes a `segments.reviewed.json` sibling with full correction provenance.

## Why this exists

Phase 1 (acquisition, CC → OpenTranscripts) is **deterministic** — a field mapping with no judgment calls, so it needs no review UI. Decomposition is the opposite: where does a Goal change? was this Segment a Failure? was the Trigger a Correction or just the next step? Every one of those is interpretive, and the decomposer will get some of them wrong.

So `segments.json` is treated as a **draft**, not an answer. This skill is where a human turns the draft into something they'd actually stand behind — and, just as importantly, where their corrections get captured in a structured, replayable form so the decompose skill can be improved from them.

## Files

| File | Role |
|---|---|
| `main.py` | Localhost HTTP server. `--tmp-dir` (required), `--port` (default 9850), `--no-browser`. Routes: `GET /` → `ui.html`, `GET /api/bundle`, `POST /api/save`. |
| `ui.html` | Single static page: editable Segment-tree outline, event-preview index, split/merge, per-Segment context notes, Save. No build step, no CDN. |
| `segment_review.py` | The provenance contract — load, validate, stamp, atomic-write. |
| `SKILL.md` | The skill contract. |

`segment_review.py` is a bundled self-contained module in this skill folder (not a shared library import) so the skill runs from a deployed `.claude/skills/` directory. It defines the correction-provenance contract that `learn-from-segment-corrections` also reads.

## The reviewed sibling

```
tmp_dir/
  transcript.json            # phase 1 output — never touched
  segments.json              # decompose draft — never touched
  segments.reviewed.json     # written here; same schema + a `review` block
```

`segments.reviewed.json` is schema-compatible with `segments.json` (analyzers read either), with two additions:

- every edited Segment carries `review: {edited: true, corrections: [...]}`
- the root Segment additionally carries `review: {reviewed_at, reviewer, base, log, warnings}` — file-level provenance plus the full append-only correction log

See the `transcript-segment` reference for the schema.

## Correction log entry types

Every edit appends one replayable entry to the log:

- `{type: "field", segment_id, field, before, after, note, at}` — a single field edit (`field` is a dotted path like `goal.text`, `trigger.kind`, `meta.event_range.0`).
- `{type: "split", segment_id, result_ids, note, at}` — a leaf Segment was split into children.
- `{type: "merge", segment_ids, result_id, note, at}` — adjacent siblings were merged.
- `{type: "note", segment_id, note, at}` — a free-text "why / context" note on a Segment.

## Design decisions

- **The draft is immutable; the review is a sibling.** Keeping `segments.json` pristine means the AI-vs-human diff is always inspectable, and a bad review can be thrown away by deleting one file.
- **Same schema, so analyzers don't care.** Downstream code calls `load_bundle`, which prefers `segments.reviewed.json` when present and falls back to `segments.json`. No analyzer needs to know whether a tree was reviewed.
- **The log is the source of truth for provenance.** `write_reviewed` strips stale `review` stamps and re-derives them from the log on every save — so the stamps can never drift from the log, and the log alone is enough for `learn-from-segment-corrections` to work.
- **Warnings never block a save.** The validator surfaces structural problems (bad enums, dangling event ids, duplicate ids), but the reviewer can save anyway. A human who knows the tree is right beats a validator that thinks it isn't.
- **Trust upstream redaction.** Secret-redaction runs once, at acquire time (phase 1): `transcript.json` and the `segments.json` decomposed from it are already redacted. The event index shipped to the browser and `segments.reviewed.json` are built from those, so this skill writes them as-is — no second redaction pass.
- **Self-contained, not DRY.** `segment_review.py` is a bundled copy, not a shared library import. A skill that runs from a deployed `.claude/skills/` copy can't reach a sibling's files, so each skill carries its own — portability beats deduplication here.
