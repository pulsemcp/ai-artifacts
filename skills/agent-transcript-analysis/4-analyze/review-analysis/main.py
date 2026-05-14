#!/usr/bin/env python3
"""Localhost review UI for AI-drafted tier-4 analyzer findings.

Thin wrapper over the shared review engine in `_lib/`. The tier-4 analyzers
emit `findings.<kind>.json` — flat lists of conclusions, one file per bucket
(outcomes, prompts, skills, mcp, cross-transcript). This skill puts one of
those drafts in front of a human in a browser: thumbs-up each finding, correct
the fields the analyzer got wrong, or reject the whole finding. Saving writes
`findings.<kind>.reviewed.json` next to the draft — the draft is never touched.

All the machinery — the HTTP server, the static UI, the correction-provenance
contract — lives in `_lib/review_server.py`, `_lib/review_ui.html`, and
`_lib/review.py`, shared with every other findings reviewer. This file only
picks a `tmp_dir` and a `kind` and calls `serve()`.

Privacy contract (identical to the rest of the plugin): localhost binding only,
no upload endpoint, every string secret-redacted before it reaches the browser
or disk.

Usage:
    python main.py --tmp-dir /path/to/transcript-tmp-dir --kind skills
    python main.py --tmp-dir ... --kind outcomes --port 9852
    python main.py --tmp-dir ... --kind mcp --no-browser
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# main.py lives at 4-analyze/review-analysis/; _lib/ is two levels up.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from _lib.review import FINDINGS_KINDS  # noqa: E402
from _lib.review_server import DEFAULT_PORT, serve  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--tmp-dir",
        required=True,
        help="transcript tmp_dir (must contain findings.<kind>.json or "
        "findings.<kind>.reviewed.json)",
    )
    p.add_argument(
        "--kind",
        required=True,
        choices=sorted(FINDINGS_KINDS),
        help="which findings bucket to review",
    )
    p.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"localhost port (default {DEFAULT_PORT})",
    )
    p.add_argument(
        "--no-browser",
        action="store_true",
        help="do not auto-open a browser (useful on remote / headless hosts)",
    )
    args = p.parse_args(argv)

    return serve(
        args.tmp_dir,
        args.kind,
        port=args.port,
        open_browser=not args.no_browser,
        title=f"{args.kind} findings",
    )


if __name__ == "__main__":
    sys.exit(main())
