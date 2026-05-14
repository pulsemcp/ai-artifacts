"""Human-in-the-loop review contract for tier-3 *findings*.

`segment_review.py` (bundled with the `review-transcript-segments` skill) is the
review contract for the recursive Segment tree.
This module is its sibling for everything *downstream* of decomposition: the
flat lists of conclusions the tier-3 analyzers produce. A Segment tree is
recursive and structural — you split and merge it. A findings list is flat and
independent — you thumbs-up each conclusion or correct it. So this module is
deliberately the *simpler* of the two: no split, no merge, no tree walk — just
per-item verdicts.

It owns the correction-provenance contract shared by the review UI
(`review_server.py` + `review_ui.html`, bundled here and driven by
`review-analysis`) and the learning skill (`learn-from-analysis-corrections`).
The contract is
deliberately `kind`-parametrised, so a future tier-4 report reviewer can reuse
it unchanged — see `REPORT_KIND` below — but today the only consumers are the
tier-3 review skills:

- **The AI draft stays pristine.** `findings.<kind>.json` is never overwritten.
- **`findings.<kind>.reviewed.json` is the human-blessed sibling.** Same schema
  as the draft (so every consumer reads it transparently — see `_resolve`),
  with two additions:
  - every reviewed item carries `review: {verdict, corrections: [...]}`
  - the document additionally carries `review: {reviewed_at, reviewer, base,
    log, warnings}`
- **The correction log is append-only and replayable.** Each entry records one
  reviewer action — `approve` (thumbs-up), `field` (edit one field of a
  finding), `reject` (the whole finding is wrong), or `note` (freeform
  context) — with a `before`/`after` where it applies. The `learn-from-*`
  skills consume this log to improve the analyzers over time.

Privacy contract (same as the rest of the plugin): the findings this reviews
were drafted from already-redacted Segments, so the reviewed document is written
as-is — there is no second redaction pass here.
"""

from __future__ import annotations

import copy
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

# --- the findings buckets a tier-3 analyzer set can produce ---------------
# Each maps to one `findings.<kind>.json` draft in a transcript tmp_dir.
FINDINGS_KINDS = {"outcomes", "prompts", "skills", "mcp", "cross-transcript"}
# `report` is reserved: the contract is kind-agnostic, so a future tier-4
# report reviewer can adopt it without a schema change. No skill emits it yet.
REPORT_KIND = "report"
ALL_KINDS = FINDINGS_KINDS | {REPORT_KIND}

# --- correction log entry types -------------------------------------------
LOG_TYPES = {"approve", "field", "reject", "note"}

# --- per-item verdicts, derived from the log (priority: high → low) -------
VERDICTS = ("rejected", "corrected", "approved", "unreviewed")

SCHEMA = "agent-transcript-analysis/findings@0.1"


def _now() -> str:
    """RFC3339 UTC, second precision — matches the `ts` style used across OT."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def draft_filename(kind: str) -> str:
    """`findings.skills.json`, `findings.cross-transcript.json`, …"""
    return f"findings.{kind}.json"


def reviewed_filename(kind: str) -> str:
    """`findings.skills.reviewed.json`, …"""
    return f"findings.{kind}.reviewed.json"


# --------------------------------------------------------------------------
# Findings traversal + validation
# --------------------------------------------------------------------------


def iter_items(doc: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Yield every finding dict in a findings document, in document order."""
    if not isinstance(doc, dict):
        return
    items = doc.get("items")
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict):
                yield item


def validate_findings(doc: dict[str, Any]) -> list[str]:
    """Return human-readable warnings about a findings document.

    **Never raises and never blocks a save** — the review UI surfaces these so
    the reviewer can decide. The contract here is intentionally thin: this
    module is schema-agnostic about an item's *contents* (each analyzer bucket
    has its own fields), it only guarantees the *envelope* — a `kind`, an
    `items` list, and a unique non-empty `id` on every item.
    """
    warnings: list[str] = []
    if not isinstance(doc, dict):
        return ["findings document is not a JSON object"]

    kind = doc.get("kind")
    if kind not in ALL_KINDS:
        warnings.append(
            f"document kind {kind!r} not in {sorted(ALL_KINDS)} "
            "(review still works; this is just a label check)"
        )

    items = doc.get("items")
    if not isinstance(items, list):
        warnings.append("document has no `items` list")
        return warnings

    seen_ids: dict[str, int] = {}
    for idx, item in enumerate(items):
        label = f"item[{idx}]"
        if not isinstance(item, dict):
            warnings.append(f"{label}: not a JSON object")
            continue
        iid = item.get("id")
        if not isinstance(iid, str) or not iid:
            warnings.append(f"{label}: missing or non-string `id`")
        else:
            seen_ids[iid] = seen_ids.get(iid, 0) + 1

    for iid, count in seen_ids.items():
        if count > 1:
            warnings.append(f"duplicate item id {iid!r} appears {count} times")

    return warnings


# --------------------------------------------------------------------------
# Load / save the review bundle
# --------------------------------------------------------------------------


def _resolve(tmp_dir: Path, kind: str) -> tuple[Path, str]:
    """Pick the findings file a reader should consume: prefer the reviewed
    sibling, fall back to the AI draft. Returns ``(path, source)`` where
    ``source`` is ``"reviewed"`` or ``"draft"``."""
    reviewed = tmp_dir / reviewed_filename(kind)
    if reviewed.exists():
        return reviewed, "reviewed"
    draft = tmp_dir / draft_filename(kind)
    if draft.exists():
        return draft, "draft"
    raise FileNotFoundError(
        f"no {reviewed_filename(kind)} or {draft_filename(kind)} in {tmp_dir} — "
        f"run the analyzers that produce the {kind!r} findings first"
    )


def load_review_bundle(tmp_dir: str | os.PathLike[str], kind: str) -> dict[str, Any]:
    """Load everything the review UI needs for one findings bucket.

    Returns ``{findings, kind, source, existing_log, tmp_dir}``:

    - ``findings``    — the findings document (reviewed sibling if present,
                        else the pristine AI draft).
    - ``kind``        — which bucket this is (``skills``, ``cross-transcript``, …).
    - ``source``      — ``"reviewed"`` or ``"draft"``: which file ``findings``
                        came from. This becomes the ``base`` of the next save.
    - ``existing_log``— the correction log already accumulated (``[]`` for a
                        first-time review).
    """
    tmp = Path(tmp_dir)
    path, source = _resolve(tmp, kind)
    with path.open("r", encoding="utf-8") as f:
        findings = json.load(f)

    existing_log: list[dict[str, Any]] = []
    if source == "reviewed" and isinstance(findings, dict):
        review = findings.get("review")
        if isinstance(review, dict) and isinstance(review.get("log"), list):
            existing_log = list(review["log"])

    return {
        "findings": findings,
        "kind": kind,
        "source": source,
        "existing_log": existing_log,
        "tmp_dir": str(tmp),
    }


def _strip_review(doc: dict[str, Any]) -> None:
    """Drop the document-level and every per-item ``review`` key, in place. The
    reviewed file is always rebuilt from the log, so stale stamps must not
    survive a round-trip."""
    if isinstance(doc, dict):
        doc.pop("review", None)
    for item in iter_items(doc):
        item.pop("review", None)


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


def _verdict(entries: list[dict[str, Any]]) -> str:
    """Derive a single verdict for an item from the log entries stamped on it.

    Priority order (``VERDICTS``): a reject beats a correction beats an
    approval. A bare ``note`` carries context but is not itself a verdict.
    """
    types = {e.get("type") for e in entries}
    if "reject" in types:
        return "rejected"
    if "field" in types:
        return "corrected"
    if "approve" in types:
        return "approved"
    return "unreviewed"


def write_reviewed(
    tmp_dir: str | os.PathLike[str],
    kind: str,
    doc: dict[str, Any],
    log: list[dict[str, Any]],
    *,
    reviewer: str = "user",
    base: str = "draft",
) -> dict[str, Any]:
    """Write ``findings.<kind>.reviewed.json`` from an edited document + its log.

    The full log is expected every call (the UI seeds it from ``existing_log``
    and appends) — this function is the single source of truth for *applying*
    it, so it is idempotent: stale ``review`` stamps are stripped and re-derived
    from the log on every write.

    Steps:
      1. Deep-copy the document (callers' objects are never mutated) and strip
         any existing ``review`` stamps.
      2. Stamp each log entry onto the item it targets — appended to
         ``review.corrections`` — and derive that item's ``review.verdict``.
      3. Validate (warnings only — never blocks the write).
      4. Attach document-level provenance under the top-level ``review`` block.
      5. Atomically replace the reviewed file (the findings were drafted from
         already-redacted Segments, so no second redaction pass runs here).

    Returns ``{path, warnings, log_size, verdict_counts}``.
    """
    tmp = Path(tmp_dir)
    root = copy.deepcopy(doc)
    if not isinstance(root, dict):
        raise ValueError("doc must be a JSON object (the findings document)")
    _strip_review(root)
    entries = _normalize_log(log)

    by_id: dict[str, dict[str, Any]] = {}
    for item in iter_items(root):
        iid = item.get("id")
        if isinstance(iid, str) and iid:
            by_id.setdefault(iid, item)

    # (2) group entries by target item, then stamp corrections + verdict
    per_item: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        iid = entry.get("item_id")
        if isinstance(iid, str) and iid:
            per_item.setdefault(iid, []).append(entry)

    verdict_counts: dict[str, int] = {v: 0 for v in VERDICTS}
    for item in iter_items(root):
        iid = item.get("id")
        stamped = per_item.get(iid, []) if isinstance(iid, str) else []
        verdict = _verdict(stamped)
        verdict_counts[verdict] = verdict_counts.get(verdict, 0) + 1
        if stamped:
            item["review"] = {"verdict": verdict, "corrections": stamped}
        else:
            item["review"] = {"verdict": "unreviewed", "corrections": []}

    # (3) validate — warnings only, never blocks the write
    warnings = validate_findings(root)
    # entries targeting an id no longer in the document are orphans worth surfacing
    known = set(by_id)
    for iid in per_item:
        if iid not in known:
            warnings.append(f"correction log targets unknown item id {iid!r}")

    # (4) document-level provenance
    root["review"] = {
        "reviewed_at": _now(),
        "reviewer": reviewer,
        "base": base,
        "log": entries,
        "warnings": warnings,
    }

    # (5) atomically write — the findings were drafted from already-redacted
    #     Segments upstream, so there is no second redaction pass here
    payload = root
    tmp.mkdir(parents=True, exist_ok=True)
    dest = tmp / reviewed_filename(kind)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(tmp), prefix=f".findings.{kind}.reviewed.", suffix=".json"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp_name, dest)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise

    return {
        "path": str(dest),
        "warnings": warnings,
        "log_size": len(entries),
        "verdict_counts": verdict_counts,
    }


__all__ = [
    "FINDINGS_KINDS",
    "REPORT_KIND",
    "ALL_KINDS",
    "LOG_TYPES",
    "VERDICTS",
    "SCHEMA",
    "draft_filename",
    "reviewed_filename",
    "iter_items",
    "validate_findings",
    "load_review_bundle",
    "write_reviewed",
]
