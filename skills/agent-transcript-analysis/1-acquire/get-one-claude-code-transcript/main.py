#!/usr/bin/env python3
"""Thin orchestrator: given a Claude Code session id, materialize a single
OpenTranscripts document under a fresh tmp dir.

Resolves the session id by scanning ``~/.claude/projects/*/<session-id>.jsonl``. If
multiple matches exist (rare — same uuid across two project dirs), the most recently
modified one wins.

Usage:
    python main.py <session-id> [--tmp-root <dir>] [--pretty]

Output layout:
    <tmp-root>/<session-id>/
        transcript.json        ← the OT document
        run.log                ← redaction summary + per-step log

If ``--tmp-root`` is omitted, ``$TMPDIR/transcript-analysis/`` is used.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from _lib.cc_jsonl import list_sessions, parse_session  # noqa: E402
from _lib.open_transcripts import session_to_transcript  # noqa: E402


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
    p.add_argument("session_id", help="Claude Code session UUID")
    p.add_argument("--tmp-root", type=Path, default=None)
    p.add_argument("--pretty", action="store_true")
    args = p.parse_args(argv)

    jsonl = resolve_session_jsonl(args.session_id)
    if jsonl is None:
        print(
            f"error: session {args.session_id} not found under ~/.claude/projects/",
            file=sys.stderr,
        )
        return 2

    tmp_root = args.tmp_root or _default_tmp_root()
    out_dir = tmp_root / args.session_id
    out_dir.mkdir(parents=True, exist_ok=True)

    session = parse_session(jsonl)
    transcript = session_to_transcript(session)

    out_path = out_dir / "transcript.json"
    with out_path.open("w", encoding="utf-8") as f:
        if args.pretty:
            json.dump(transcript, f, ensure_ascii=False, indent=2)
        else:
            json.dump(transcript, f, ensure_ascii=False)

    log_path = out_dir / "run.log"
    with log_path.open("w", encoding="utf-8") as f:
        f.write(f"source: {jsonl}\n")
        f.write(f"session_id: {args.session_id}\n")
        f.write(f"parent_lines: {len(session.parent_lines)}\n")
        f.write(f"subagents: {len(session.subagents)}\n")
        for sub in session.subagents:
            f.write(
                f"  - {sub.ref.agent_id} ({sub.ref.agent_type}) "
                f"{len(sub.lines)} lines from {sub.ref.jsonl_path}\n"
            )
        f.write(f"events: {len(transcript['events'])}\n")
        f.write(f"final_metrics: {transcript['final_metrics']}\n")

    print(out_dir, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
