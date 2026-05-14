#!/usr/bin/env python3
"""Localhost review UI for an AI-drafted Transcript Segment tree.

Decomposition (``2-decompose/decompose-agent-transcript-into-transcript-segments``) is the most
interpretive step in the pipeline — where Goals change, whether a Segment was a
Failure, what the Trigger was. Its ``segments.json`` is therefore a *draft*. This
server lets a human audit and correct that draft in a browser:

- loads ``segments.json`` (or the existing ``segments.reviewed.json`` to keep
  iterating) plus a compact, redacted event index from ``transcript.json``
- serves a single static ``ui.html`` for editing every field, splitting a leaf
  Segment, merging adjacent siblings, and attaching context notes
- on Save, writes ``segments.reviewed.json`` next to the draft — the draft is
  never overwritten — with full correction provenance (see
  ``_lib/segment_review.py``)

Privacy contract (identical to the picker): localhost binding only, no upload
endpoint, every string is secret-redacted before it reaches the browser or disk.

Usage:
    python main.py --tmp-dir /path/to/transcript-tmp-dir
    python main.py --tmp-dir ... --port 9851
    python main.py --tmp-dir ... --no-browser
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import socketserver
import sys
import threading
import urllib.parse
import webbrowser
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from _lib.segment_review import (  # noqa: E402
    load_bundle,
    validate_tree,
    write_reviewed,
)

UI_HTML = Path(__file__).with_name("ui.html")

# Set once from argv in main(); the request handler reads it.
TMP_DIR: Path = Path(".")


class Handler(http.server.SimpleHTTPRequestHandler):
    """Serves:

    - ``GET  /``           → ``ui.html``
    - ``GET  /api/bundle`` → ``{segments, event_index, source, existing_log, tmp_dir}``
    - ``POST /api/save``   → body ``{root, log, reviewer?}`` → writes
                             ``segments.reviewed.json``; returns
                             ``{ok, path, warnings, log_size}``
    """

    server_version = "agent-transcript-analysis-review/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # quieter default
        sys.stderr.write(f"[ui] {fmt % args}\n")

    def _send_json(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            if not UI_HTML.exists():
                self.send_error(500, "ui.html missing")
                return
            body = UI_HTML.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/bundle":
            try:
                bundle = load_bundle(TMP_DIR)
            except FileNotFoundError as e:
                self._send_json(404, {"error": str(e)})
                return
            except (OSError, json.JSONDecodeError) as e:
                self._send_json(500, {"error": f"failed to load bundle: {e}"})
                return
            # surface validation warnings up front so the user sees what the
            # decomposer got wrong before they start editing.
            bundle["warnings"] = validate_tree(
                bundle["segments"], bundle["event_index"]
            )
            self._send_json(200, bundle)
            return
        self.send_error(404, "not found")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/save":
            self.send_error(404, "not found")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            self._send_json(400, {"error": f"invalid JSON body: {e}"})
            return

        root = body.get("root")
        log = body.get("log", [])
        base = body.get("base", "draft")
        reviewer = body.get("reviewer") or "user"
        if not isinstance(root, dict):
            self._send_json(400, {"error": "body.root must be the root Segment object"})
            return
        if not isinstance(log, list):
            self._send_json(400, {"error": "body.log must be a list"})
            return

        try:
            result = write_reviewed(
                TMP_DIR, root, log, reviewer=str(reviewer), base=str(base)
            )
        except (OSError, ValueError) as e:
            self._send_json(500, {"error": f"failed to write reviewed file: {e}"})
            return
        self._send_json(200, {"ok": True, **result})


def main(argv: list[str] | None = None) -> int:
    global TMP_DIR
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--tmp-dir",
        required=True,
        help="transcript tmp_dir (must contain segments.json or segments.reviewed.json)",
    )
    p.add_argument("--port", type=int, default=int(os.environ.get("ATA_REVIEW_PORT", "9850")))
    p.add_argument("--no-browser", action="store_true")
    args = p.parse_args(argv)

    TMP_DIR = Path(args.tmp_dir).expanduser().resolve()
    if not TMP_DIR.is_dir():
        print(f"error: --tmp-dir {TMP_DIR} is not a directory", file=sys.stderr)
        return 2
    if not (TMP_DIR / "segments.json").exists() and not (
        TMP_DIR / "segments.reviewed.json"
    ).exists():
        print(
            f"error: {TMP_DIR} has no segments.json or segments.reviewed.json — "
            "run decompose-agent-transcript-into-transcript-segments first",
            file=sys.stderr,
        )
        return 2

    # allow_reuse_address must be a class attribute: ThreadingTCPServer.__init__
    # binds inline, so setting it on the instance afterward is a no-op and leaves
    # quick restarts hitting TIME_WAIT.
    class _Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True

    httpd = _Server(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"review UI for {TMP_DIR} on {url}", flush=True)
    print(
        "edit the Segment tree → Save writes segments.reviewed.json "
        "(segments.json is never touched)",
        flush=True,
    )
    if not args.no_browser:
        threading.Thread(target=lambda: webbrowser.open(url), daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("shutting down", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
