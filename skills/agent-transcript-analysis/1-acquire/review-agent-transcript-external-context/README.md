# `review-agent-transcript-external-context`

The human review checkpoint for the context bundle. Opens a localhost UI to audit and correct the inferred `external-context.json`, and writes an `external-context.reviewed.json` sibling with full correction provenance.

## Why this exists

`gather-agent-transcript-external-context` works by inference: it reads branch names, URLs in messages, and repo slugs and *guesses* which ticket, which PR, which project. Some guesses are wrong, and a confident-but-wrong ticket poisons every downstream analyzer that grounds itself in the Goal.

So `external-context.json` is treated as a **draft**, not an answer — the same stance `review-agent-transcript-segments` takes toward `segments.json`. This skill is where a human confirms or fixes the inference, and where their corrections get captured in a structured form that shows exactly where the gatherer went wrong.

## Status

`SKILL.md` and this README are the **design contract**. The localhost server (`main.py` + `ui.html`) is not yet implemented — build it following the `review-agent-transcript-segments` pattern, reusing the correction-provenance approach from that skill's bundled `segment_review.py` (generalized from the Segment tree to the context bundle). Bundle a self-contained copy of whatever it needs into this skill folder, the same way `review-agent-transcript-segments` and `review-agent-transcript-analysis` carry their own modules.

## Files

| File | Role |
|---|---|
| `main.py` | *(planned)* Localhost HTTP server. `--tmp-dir` (required), `--port` (default 9851), `--no-browser`. Routes: `GET /` → `ui.html`, `GET /api/bundle`, `POST /api/save`. |
| `ui.html` | *(planned)* Single static page: editable ticket / PR / user-context blocks, the `how_found` evidence preview, per-correction context notes, Save. No build step, no CDN. |
| `SKILL.md` | The skill contract. |

## The reviewed sibling

```
tmp_dir/
  transcript.json                    # phase 1 — never touched
  external-context.json              # gather-agent-transcript-external-context draft — never touched
  external-context.reviewed.json     # written here; same schema + a `review` block
```

`external-context.reviewed.json` is schema-compatible with `external-context.json` (downstream reads either), with two additions:

- every edited block carries `review: {edited: true, corrections: [...]}`
- the root additionally carries `review: {reviewed_at, reviewer, base, log}` — file-level provenance plus the full append-only correction log

## Design decisions

- **The draft is immutable; the review is a sibling.** Keeping `external-context.json` pristine means the gatherer-vs-human diff is always inspectable, and a bad review can be thrown away by deleting one file. Same contract as `review-agent-transcript-segments`.
- **Same schema, so readers don't care.** Downstream code prefers `external-context.reviewed.json` when present and falls back to the draft — no analyzer needs to know whether a human touched it.
- **Audit against evidence, not from scratch.** The UI shows each block's `how_found` next to it, so the reviewer is confirming or rejecting a specific inference rather than re-researching the session.
- **Corrections are signal, but flagged — not applied.** The corrections show where `gather-agent-transcript-external-context` mis-inferred; surfacing that as an improvement opportunity for the user is in scope, editing the gatherer is not.
- **Trust upstream redaction.** Secret-redaction runs once, at acquire time: `gather-agent-transcript-external-context` redacts `external-context.json` as it writes it. The evidence preview and `external-context.reviewed.json` are built from that already-redacted draft, so this skill writes them as-is — no second redaction pass.
