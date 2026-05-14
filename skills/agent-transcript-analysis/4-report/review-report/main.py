#!/usr/bin/env python3
"""Localhost review UI for the AI-synthesized tier-4 report.

Thin wrapper over the review engine bundled alongside this skill. `synthesize-report`
emits `findings.report.json` — the consolidated recommendation slate, in the same
`{kind, items}` envelope every tier-3 findings file uses, with `kind: "report"`.
This skill puts that draft in front of a human in a browser: thumbs-up each
recommendation, correct the fields the synthesis got wrong, or reject the ones
whose leap from the findings doesn't hold. Saving writes
`findings.report.reviewed.json` next to the draft — the draft is never touched.

All the machinery — the HTTP server, the static UI, the correction-provenance
contract — lives in the bundled `review_server.py`, `review_ui.html`, and
`review.py`. They are byte-identical copies of the engine `review-analysis`
bundles: `REPORT_KIND` was reserved in that contract from the start, so the
report reviews with no new code. This file only picks a `tmp_dir`, pins the
`kind` to `report`, and calls `serve()`.

Privacy contract (identical to the rest of the plugin): localhost binding only,
no upload endpoint. The `findings.report.json` this serves was synthesized from
already-redacted findings upstream, so this server trusts the draft as-is.

Usage:
    python main.py --tmp-dir /path/to/transcript-tmp-dir
    python main.py --tmp-dir ... --port 9853
    python main.py --tmp-dir ... --no-browser
"""

from __future__ import annotations

import argparse
import sys

from review import REPORT_KIND
from review_server import serve

DEFAULT_PORT = 9853


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--tmp-dir",
        required=True,
        help="transcript tmp_dir (must contain findings.report.json or "
        "findings.report.reviewed.json)",
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
        REPORT_KIND,
        port=args.port,
        open_browser=not args.no_browser,
        title="report recommendations",
    )


if __name__ == "__main__":
    sys.exit(main())
