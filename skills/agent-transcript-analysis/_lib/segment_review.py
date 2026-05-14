"""Human-in-the-loop review contract for the Transcript Segment tree.

`2-decompose/decompose-into-transcript-segments` emits `segments.json` — an
AI-drafted decomposition. Decomposition is the most *interpretive* step in the
pipeline (where do Goals change? was this a Failure?), so its output is a draft
the user audits and corrects, not a final answer.

This module owns the correction-provenance contract shared by the review UI
(`2-decompose/review-transcript-segments`) and the learning skill
(`2-decompose/learn-from-segment-corrections`):

- **`segments.json` stays pristine.** The AI draft is never overwritten.
- **`segments.reviewed.json` is the human-blessed sibling.** Same schema as
  `segments.json` (so every downstream analyzer reads it transparently — see
  `_resolve` in this module), with two additions:
  - every edited Segment carries `review: {edited: true, corrections: [...]}`
  - the root Segment additionally carries file-level provenance under
    `review: {reviewed_at, reviewer, base, log, warnings}`
- **The correction log is append-only and replayable.** Each entry records
  one user action (`field` edit, `split`, `merge`, or freeform `note`) with a
  `before`/`after` and an optional context `note`. `learn-from-segment-corrections`
  consumes this log to improve the decompose skill over time.

Privacy contract (same as the rest of the plugin): every string in the
reviewed document is run through `redact()` before it touches disk.
"""

from __future__ import annotations

import copy
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .redaction import redact, redact_string

# --- enums (mirror references/open-transcripts/schemas/transcript-segment.md) ---
TRIGGER_KINDS = {"New", "Correction"}
TRIGGER_SOURCES = {"user", "agent", "subagent"}
GOAL_KINDS = {"Plan", "Action"}
OUTCOME_KINDS = {"Success", "Failure"}

# --- filenames inside a get-claude-code-transcript tmp_dir ---
TRANSCRIPT_FILENAME = "transcript.json"
DRAFT_FILENAME = "segments.json"
REVIEWED_FILENAME = "segments.reviewed.json"

# --- correction log entry types ---
LOG_TYPES = {"field", "split", "merge", "note"}

PREVIEW_MAX_CHARS = 280


def _now() -> str:
    """RFC3339 UTC, second precision — matches the `ts` style used across OT."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------
# Event index — a compact, redacted lookup the review UI shows next to each
# Segment so the user can sanity-check boundaries and pick evidence events
# without the server ever shipping the full transcript to the browser.
# --------------------------------------------------------------------------


def _text_from_content(content: Any) -> str:
    """Pull plain text out of an OT ContentPart[] (or a bare string)."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for p in content:
        if isinstance(p, str):
            parts.append(p)
        elif isinstance(p, dict):
            if p.get("type") == "text" and isinstance(p.get("text"), str):
                parts.append(p["text"])
            elif p.get("type") == "image":
                parts.append("[image]")
    return " ".join(parts).strip()


def summarize_event(ev: dict[str, Any]) -> dict[str, Any]:
    """One redacted, single-line summary of an OT event: ``{id, type, ts, preview}``.

    The preview is type-aware (a ToolCall shows tool name + key argument, a
    UserMessage shows its text, etc.) and capped at ``PREVIEW_MAX_CHARS``.
    """
    etype = ev.get("type", "") or ""
    preview: str = ""
    if etype in ("UserMessage", "AssistantMessage"):
        preview = _text_from_content(ev.get("content"))
        if not preview and etype == "AssistantMessage":
            preview = "(tool calls / thinking only)"
    elif etype == "Thinking":
        preview = ev.get("text") or ""
    elif etype == "ToolCall":
        name = ev.get("tool_name") or "?"
        args = ev.get("arguments")
        detail = ""
        if isinstance(args, dict):
            for k in ("file_path", "path", "command", "pattern", "url", "query", "description"):
                v = args.get(k)
                if isinstance(v, str) and v:
                    detail = f"{k}={v}"
                    break
        preview = f"{name}({detail})" if detail else name
    elif etype == "ToolResult":
        body = _text_from_content(ev.get("output"))
        preview = ("error: " + body) if ev.get("is_error") else body
    elif etype == "SubagentSpawn":
        st = ev.get("subagent_type") or "subagent"
        desc = ev.get("description") or ""
        prompt = ev.get("prompt") or ""
        preview = f"[{st}] {desc} {prompt}".strip()
    elif etype == "Error":
        preview = ev.get("message") or ev.get("code") or "error"
    elif etype == "Compaction":
        preview = "context compaction"
    elif etype == "SystemEvent":
        preview = f"system: {ev.get('subtype') or ''}".strip()
    else:
        preview = etype

    preview = " ".join(str(preview).split())
    if len(preview) > PREVIEW_MAX_CHARS:
        preview = preview[: PREVIEW_MAX_CHARS - 1].rstrip() + "…"
    return {
        "id": ev.get("id"),
        "type": etype,
        "ts": ev.get("ts"),
        # transcript.json is already redacted at build time; redact again here
        # as defense-in-depth before anything reaches the browser.
        "preview": redact_string(preview),
    }


def walk_events(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten a Transcript's events in document order.

    A transcript's own ``events[]`` come first and contiguously, then each
    subagent's events (recursively) — the same order the decomposer walks, so
    ``event_range`` ids line up with this sequence.
    """
    out: list[dict[str, Any]] = []

    def _walk(t: Any) -> None:
        if not isinstance(t, dict):
            return
        evs = t.get("events")
        if isinstance(evs, list):
            out.extend(e for e in evs if isinstance(e, dict))
        subs = t.get("subagents")
        if isinstance(subs, list):
            for s in subs:
                _walk(s)

    _walk(transcript)
    return out


def build_event_index(transcript: dict[str, Any]) -> dict[str, Any]:
    """``{order: [event_id, ...], events: {event_id: summary}}`` for a Transcript."""
    order: list[str] = []
    events: dict[str, Any] = {}
    for ev in walk_events(transcript):
        eid = ev.get("id")
        if not isinstance(eid, str) or eid in events:
            continue
        order.append(eid)
        events[eid] = summarize_event(ev)
    return {"order": order, "events": events}


# --------------------------------------------------------------------------
# Segment tree traversal + validation
# --------------------------------------------------------------------------


def iter_segments(root: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Depth-first, document order. Yields every Segment dict in the tree."""
    if not isinstance(root, dict):
        return
    yield root
    children = root.get("children")
    if isinstance(children, list):
        for child in children:
            if isinstance(child, dict):
                yield from iter_segments(child)


def validate_tree(
    root: dict[str, Any], event_index: dict[str, Any] | None = None
) -> list[str]:
    """Return human-readable warnings about a Segment tree.

    **Never raises and never blocks a save** — the review UI surfaces these so
    the user can decide. A user is allowed to save a tree that still has
    warnings (their judgment beats the validator's).
    """
    warnings: list[str] = []
    if not isinstance(root, dict):
        return ["root segment is not a JSON object"]

    known_event_ids: set[str] | None = None
    if event_index and isinstance(event_index.get("events"), dict):
        known_event_ids = set(event_index["events"].keys())

    seen_ids: dict[str, int] = {}
    for seg in iter_segments(root):
        sid = seg.get("id")
        label = sid if isinstance(sid, str) and sid else "(unnamed segment)"
        if not isinstance(sid, str) or not sid:
            warnings.append(f"{label}: missing or non-string id")
        else:
            seen_ids[sid] = seen_ids.get(sid, 0) + 1

        trigger = seg.get("trigger")
        if not isinstance(trigger, dict):
            warnings.append(f"{label}: missing trigger block")
        else:
            tk, tsrc = trigger.get("kind"), trigger.get("source")
            if tk not in TRIGGER_KINDS:
                warnings.append(f"{label}: trigger.kind {tk!r} not in {sorted(TRIGGER_KINDS)}")
            if tsrc not in TRIGGER_SOURCES:
                warnings.append(
                    f"{label}: trigger.source {tsrc!r} not in {sorted(TRIGGER_SOURCES)}"
                )
            if tsrc == "agent":
                if trigger.get("event_id") is not None or trigger.get("text") is not None:
                    warnings.append(
                        f"{label}: agent-source trigger must have null event_id and text"
                    )
            elif tsrc in ("user", "subagent"):
                if not trigger.get("event_id"):
                    warnings.append(f"{label}: {tsrc}-source trigger is missing event_id")
                elif known_event_ids is not None and trigger["event_id"] not in known_event_ids:
                    warnings.append(
                        f"{label}: trigger.event_id {trigger['event_id']!r} "
                        "not found in transcript"
                    )
                if not trigger.get("text"):
                    warnings.append(f"{label}: {tsrc}-source trigger is missing text")

        goal = seg.get("goal")
        if not isinstance(goal, dict):
            warnings.append(f"{label}: missing goal block")
        else:
            if goal.get("kind") not in GOAL_KINDS:
                warnings.append(
                    f"{label}: goal.kind {goal.get('kind')!r} not in {sorted(GOAL_KINDS)}"
                )
            if not (isinstance(goal.get("text"), str) and goal["text"].strip()):
                warnings.append(f"{label}: goal.text is empty")

        outcome = seg.get("outcome")
        if not isinstance(outcome, dict):
            warnings.append(f"{label}: missing outcome block")
        else:
            if outcome.get("kind") not in OUTCOME_KINDS:
                warnings.append(
                    f"{label}: outcome.kind {outcome.get('kind')!r} not in {sorted(OUTCOME_KINDS)}"
                )
            ev_ids = outcome.get("evidence_event_ids")
            if ev_ids is None:
                pass
            elif not isinstance(ev_ids, list):
                warnings.append(f"{label}: outcome.evidence_event_ids is not a list")
            elif known_event_ids is not None:
                for eid in ev_ids:
                    if eid not in known_event_ids:
                        warnings.append(
                            f"{label}: evidence_event_id {eid!r} not found in transcript"
                        )

        children = seg.get("children")
        if children is not None and not isinstance(children, list):
            warnings.append(f"{label}: children is not a list")

    for sid, count in seen_ids.items():
        if count > 1:
            warnings.append(f"duplicate segment id {sid!r} appears {count} times")

    root_trigger = root.get("trigger") if isinstance(root.get("trigger"), dict) else {}
    if root_trigger.get("source") not in ("user", "subagent"):
        warnings.append("root segment trigger.source should be 'user' or 'subagent'")
    if root_trigger.get("kind") != "New":
        warnings.append("root segment trigger.kind should be 'New'")

    return warnings


# --------------------------------------------------------------------------
# Load / save the review bundle
# --------------------------------------------------------------------------


def _resolve(tmp_dir: Path) -> tuple[Path, str]:
    """Pick the Segment file a reader should consume: prefer the reviewed
    sibling, fall back to the AI draft. Returns ``(path, source)`` where
    ``source`` is ``"reviewed"`` or ``"draft"``."""
    reviewed = tmp_dir / REVIEWED_FILENAME
    if reviewed.exists():
        return reviewed, "reviewed"
    draft = tmp_dir / DRAFT_FILENAME
    if draft.exists():
        return draft, "draft"
    raise FileNotFoundError(
        f"no {REVIEWED_FILENAME} or {DRAFT_FILENAME} in {tmp_dir} — "
        "run decompose-into-transcript-segments first"
    )


def load_bundle(tmp_dir: str | os.PathLike[str]) -> dict[str, Any]:
    """Load everything the review UI needs from a transcript tmp_dir.

    Returns ``{segments, event_index, source, existing_log, tmp_dir}``:

    - ``segments``    — the root Segment dict (reviewed sibling if present,
                        else the pristine AI draft).
    - ``event_index`` — compact redacted ``{order, events}`` lookup, or empty
                        if ``transcript.json`` is missing/unreadable.
    - ``source``      — ``"reviewed"`` or ``"draft"``: which file ``segments``
                        came from. This becomes the ``base`` of the next save.
    - ``existing_log``— the correction log already accumulated (``[]`` for a
                        first-time review).
    """
    tmp = Path(tmp_dir)
    seg_path, source = _resolve(tmp)
    with seg_path.open("r", encoding="utf-8") as f:
        segments = json.load(f)

    existing_log: list[dict[str, Any]] = []
    if source == "reviewed" and isinstance(segments, dict):
        review = segments.get("review")
        if isinstance(review, dict) and isinstance(review.get("log"), list):
            existing_log = list(review["log"])

    event_index: dict[str, Any] = {"order": [], "events": {}}
    transcript_path = tmp / TRANSCRIPT_FILENAME
    if transcript_path.exists():
        try:
            with transcript_path.open("r", encoding="utf-8") as f:
                event_index = build_event_index(json.load(f))
        except (OSError, json.JSONDecodeError):
            pass  # the UI still works without it; boundaries just aren't cross-checked

    return {
        "segments": segments,
        "event_index": event_index,
        "source": source,
        "existing_log": existing_log,
        "tmp_dir": str(tmp),
    }


def _strip_review(root: dict[str, Any]) -> None:
    """Drop every ``review`` key in the tree, in place. The reviewed file is
    always rebuilt from the log, so stale stamps must not survive a round-trip."""
    for seg in iter_segments(root):
        seg.pop("review", None)


def _targets_of(entry: dict[str, Any]) -> list[str]:
    """Which Segment id(s) a correction log entry should be stamped onto."""
    etype = entry.get("type")
    if etype in ("field", "note"):
        sid = entry.get("segment_id")
        return [sid] if isinstance(sid, str) and sid else []
    if etype == "split":
        ids = entry.get("result_ids")
        return [i for i in ids if isinstance(i, str) and i] if isinstance(ids, list) else []
    if etype == "merge":
        rid = entry.get("result_id")
        return [rid] if isinstance(rid, str) and rid else []
    return []


def _normalize_log(log: Any) -> list[dict[str, Any]]:
    """Coerce the incoming log to a clean list of entry dicts, dropping junk
    and stamping ``at`` on anything missing it."""
    out: list[dict[str, Any]] = []
    if not isinstance(log, list):
        return out
    for raw in log:
        if not isinstance(raw, dict):
            continue
        if raw.get("type") not in LOG_TYPES:
            continue
        entry = dict(raw)
        if not entry.get("at"):
            entry["at"] = _now()
        out.append(entry)
    return out


def write_reviewed(
    tmp_dir: str | os.PathLike[str],
    root_segment: dict[str, Any],
    log: list[dict[str, Any]],
    *,
    reviewer: str = "user",
    base: str = "draft",
) -> dict[str, Any]:
    """Write ``segments.reviewed.json`` from an edited tree + its full correction log.

    The full log is expected every call (the UI seeds it from ``existing_log``
    and appends) — this function is the single source of truth for *applying*
    it, so it is idempotent: stale ``review`` stamps are stripped and re-derived
    from the log on every write.

    Steps:
      1. Deep-copy the tree (callers' objects are never mutated) and strip any
         existing ``review`` stamps.
      2. Stamp each log entry onto every Segment it targets
         (``review.edited = true`` + appended to ``review.corrections``).
      3. Validate (warnings only — never blocks the write).
      4. Attach file-level provenance to the root Segment's ``review`` block.
      5. Redact every string, then atomically replace ``segments.reviewed.json``.

    Returns ``{path, warnings, log_size}``.
    """
    tmp = Path(tmp_dir)
    root = copy.deepcopy(root_segment)
    if not isinstance(root, dict):
        raise ValueError("root_segment must be a JSON object (the root Segment)")
    _strip_review(root)
    entries = _normalize_log(log)

    by_id: dict[str, dict[str, Any]] = {}
    for seg in iter_segments(root):
        sid = seg.get("id")
        if isinstance(sid, str) and sid:
            by_id.setdefault(sid, seg)

    # (2) stamp corrections onto their target Segments
    for entry in entries:
        for sid in _targets_of(entry):
            seg = by_id.get(sid)
            if seg is None:
                continue  # orphaned entry (e.g. id from a since-merged segment)
            review = seg.get("review")
            if not isinstance(review, dict):
                review = {"edited": True, "corrections": []}
                seg["review"] = review
            review["edited"] = True
            review.setdefault("corrections", []).append(entry)

    # (3) validate — warnings only. Cross-check event ids against the
    #     transcript if it is sitting next to the segment files.
    event_index: dict[str, Any] | None = None
    transcript_path = tmp / TRANSCRIPT_FILENAME
    if transcript_path.exists():
        try:
            with transcript_path.open("r", encoding="utf-8") as f:
                event_index = build_event_index(json.load(f))
        except (OSError, json.JSONDecodeError):
            event_index = None
    warnings = validate_tree(root, event_index)

    # (4) file-level provenance on the root's review block (coexists with any
    #     per-segment correction stamps the root itself may carry)
    root_review = root.get("review")
    if not isinstance(root_review, dict):
        root_review = {}
        root["review"] = root_review
    root_review["reviewed_at"] = _now()
    root_review["reviewer"] = reviewer
    root_review["base"] = base
    root_review["log"] = entries
    root_review["warnings"] = warnings

    # (5) redact, then atomically write
    doc = redact(root)
    tmp.mkdir(parents=True, exist_ok=True)
    dest = tmp / REVIEWED_FILENAME
    fd, tmp_name = tempfile.mkstemp(
        dir=str(tmp), prefix=".segments.reviewed.", suffix=".json"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
        os.replace(tmp_name, dest)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise

    return {"path": str(dest), "warnings": warnings, "log_size": len(entries)}


__all__ = [
    "TRIGGER_KINDS",
    "TRIGGER_SOURCES",
    "GOAL_KINDS",
    "OUTCOME_KINDS",
    "LOG_TYPES",
    "TRANSCRIPT_FILENAME",
    "DRAFT_FILENAME",
    "REVIEWED_FILENAME",
    "summarize_event",
    "walk_events",
    "build_event_index",
    "iter_segments",
    "validate_tree",
    "load_bundle",
    "write_reviewed",
]
