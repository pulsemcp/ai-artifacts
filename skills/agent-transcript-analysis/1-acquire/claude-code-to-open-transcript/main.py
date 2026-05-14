#!/usr/bin/env python3
"""Transform a Claude Code session JSONL into a single OpenTranscripts document.

Deterministic. No LLM. Secret-redaction happens inline. Subagents are loaded from
``<session-uuid>/subagents/agent-<id>.jsonl`` (with legacy sibling-file fallback) and
embedded recursively.

Usage:
    python main.py <path-to-session.jsonl> [--out <output.json>] [--pretty]

If ``--out`` is omitted, the transcript is written to ``transcript.json`` next to the
source JSONL. Output is one line of compact JSON by default; pass ``--pretty`` for an
indented document.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Make _lib importable when this script is run directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from _lib.cc_jsonl import parse_session  # noqa: E402
from _lib.open_transcripts import session_to_transcript  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("jsonl", type=Path, help="Path to a CC session JSONL file")
    p.add_argument("--out", type=Path, default=None, help="Where to write the OT JSON")
    p.add_argument("--pretty", action="store_true", help="Indent output JSON")
    args = p.parse_args(argv)

    if not args.jsonl.exists():
        print(f"error: {args.jsonl} does not exist", file=sys.stderr)
        return 2

    session = parse_session(args.jsonl)
    transcript = session_to_transcript(session)

    out_path = args.out or args.jsonl.with_name("transcript.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        if args.pretty:
            json.dump(transcript, f, ensure_ascii=False, indent=2)
        else:
            json.dump(transcript, f, ensure_ascii=False)

    n_events = len(transcript["events"])
    n_subs = len(transcript["subagents"])
    size = out_path.stat().st_size
    print(
        f"wrote {out_path} ({size:,} bytes, {n_events} events, {n_subs} subagents)",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
