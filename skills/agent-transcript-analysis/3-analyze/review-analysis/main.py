#!/usr/bin/env python3
"""Localhost review UI for AI-drafted tier-3 analyzer findings.

Thin wrapper over the review engine bundled alongside this skill. The tier-3
analyzers emit `findings.<kind>.json` — flat lists of conclusions, one file per
bucket (outcomes, prompts, skills, mcp, cross-transcript). This skill puts one
of those drafts in front of a human in a browser: thumbs-up each finding,
correct the fields the analyzer got wrong, or reject the whole finding. Saving
writes `findings.<kind>.reviewed.json` next to the draft — the draft is never
touched.

All the machinery — the HTTP server, the static UI, the correction-provenance
contract — lives in the bundled `review_server.py`, `review_ui.html`, and
`review.py`. This file only picks a `tmp_dir` and a `kind` and calls `serve()`.

Privacy contract (identical to the rest of the plugin): localhost binding only,
no upload endpoint. The `findings.<kind>.json` this serves was drafted from
already-redacted Segments, so this server trusts the draft as-is.

Usage:
    python main.py --tmp-dir /path/to/transcript-tmp-dir --kind skills
    python main.py --tmp-dir ... --kind outcomes --port 9852
    python main.py --tmp-dir ... --kind mcp --no-browser
"""

from __future__ import annotations

import argparse
import sys

from review import FINDINGS_KINDS
from review_server import DEFAULT_PORT, serve


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
