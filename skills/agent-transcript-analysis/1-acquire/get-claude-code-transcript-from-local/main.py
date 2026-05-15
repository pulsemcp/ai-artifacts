#!/usr/bin/env python3
"""Acquire one Claude Code session as a single OpenTranscripts document.

Given a session id (or a JSONL path directly), materialize one redacted
`transcript.json` under a fresh tmp dir — the main session plus every subagent
it spawned, linked and embedded recursively. The CC -> OpenTranscripts mapping
is deterministic (no LLM, no heuristics); secret-redaction runs inline.

Usage:
    python main.py <session-id> [--tmp-root <dir>] [--pretty]
    python main.py --jsonl <path-to-session.jsonl> [--tmp-root <dir>] [--pretty]

A session id is resolved by scanning ``~/.claude/projects/*/<session-id>.jsonl``.
If multiple matches exist (same uuid across two project dirs), the most recently
modified one wins.

Output layout:
    <tmp-root>/<session-id>/
        transcript.json        the OT document (redacted)
        run.log                source, line/subagent/event counts, final metrics

If ``--tmp-root`` is omitted, ``$TMPDIR/transcript-analysis/`` is used.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path

from cc_jsonl import list_sessions, parse_session
from open_transcripts import session_to_transcript, validate_transcript


def _default_tmp_root() -> Path:
    base = Path(os.environ.get("TMPDIR", tempfile.gettempdir()))
    return base / "transcript-analysis"


def resolve_session_jsonl(session_id: str) -> Path | None:
    matches = [s for s in list_sessions() if s["session_id"] == session_id]
    if not matches:
        return None
    matches.sort(key=lambda s: s["mtime"], reverse=True)
    return Path(matches[0]["jsonl_path"])


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("session_id", nargs="?", help="Claude Code session UUID")
    p.add_argument(
        "--jsonl",
        type=Path,
        default=None,
        help="Path to a CC session JSONL, used instead of a session id",
    )
    p.add_argument("--tmp-root", type=Path, default=None)
    p.add_argument("--pretty", action="store_true")
    args = p.parse_args(argv)

    if bool(args.session_id) == bool(args.jsonl):
        print(
            "error: pass exactly one of <session-id> or --jsonl <path>",
            file=sys.stderr,
        )
        return 2

    if args.jsonl is not None:
        jsonl = args.jsonl
        if not jsonl.exists():
            print(f"error: {jsonl} does not exist", file=sys.stderr)
            return 2
        session_id = jsonl.stem
    else:
        session_id = args.session_id
        resolved = resolve_session_jsonl(session_id)
        if resolved is None:
            print(
                f"error: session {session_id} not found under ~/.claude/projects/",
                file=sys.stderr,
            )
            return 2
        jsonl = resolved

    tmp_root = args.tmp_root or _default_tmp_root()
    out_dir = tmp_root / session_id
    out_dir.mkdir(parents=True, exist_ok=True)

    session = parse_session(jsonl)
    transcript = session_to_transcript(session)

    out_path = out_dir / "transcript.json"
    with out_path.open("w", encoding="utf-8") as f:
        if args.pretty:
            json.dump(transcript, f, ensure_ascii=False, indent=2)
        else:
            json.dump(transcript, f, ensure_ascii=False)

    # Roll up event counts across the whole tree (parent + every nested
    # subagent) for the run log.
    def _tree_events(t: dict) -> list[dict]:
        evs = list(t.get("events") or [])
        for child in t.get("subagents") or []:
            evs.extend(_tree_events(child))
        return evs

    all_events = _tree_events(transcript)
    type_counts = Counter(e.get("type") for e in all_events)
    raw = (transcript.get("provider") or {}).get("raw") or {}
    unmapped = raw.get("unmapped_lines") or []
    problems = validate_transcript(transcript)

    # Redaction-counts-by-pattern come from scanning the final transcript JSON
    # for the `<REDACTED:LABEL>` markers the redaction patterns inject. This
    # captures every redaction across the tree (parent + nested subagents),
    # by definition matches what landed on disk, and avoids threading a tally
    # dict through every redact() call site.
    _redaction_pat = re.compile(r"<REDACTED:([A-Z_]+)>")
    transcript_blob = json.dumps(transcript, ensure_ascii=False)
    redaction_counts = Counter(_redaction_pat.findall(transcript_blob))

    log_path = out_dir / "run.log"
    with log_path.open("w", encoding="utf-8") as f:
        f.write(f"source: {jsonl}\n")
        f.write(f"session_id: {session_id}\n")
        f.write(f"parent_lines: {len(session.parent_lines)}\n")
        f.write(f"subagents: {len(session.subagents)}\n")
        for sub in session.subagents:
            f.write(
                f"  - {sub.ref.agent_id} ({sub.ref.agent_type}) "
                f"{len(sub.lines)} lines from {sub.ref.jsonl_path}\n"
            )
        f.write(f"events: {len(transcript['events'])} (tree total: {len(all_events)})\n")
        f.write(f"event_types: {dict(sorted(type_counts.items()))}\n")
        f.write(f"unmapped_lines: {len(unmapped)}\n")
        if redaction_counts:
            f.write(f"redaction_counts: {dict(sorted(redaction_counts.items()))}\n")
        else:
            f.write("redaction_counts: {} (no secrets matched)\n")
        f.write(f"final_metrics: {transcript['final_metrics']}\n")
        if problems:
            f.write(f"validation: FAILED ({len(problems)} violation(s))\n")
            for prob in problems:
                f.write(f"  - {prob}\n")
        else:
            f.write("validation: OK\n")

    if problems:
        print(
            f"WARNING: transcript failed {len(problems)} invariant check(s); "
            f"see {log_path}",
            file=sys.stderr,
        )
        for prob in problems:
            print(f"  - {prob}", file=sys.stderr)

    print(out_dir, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
