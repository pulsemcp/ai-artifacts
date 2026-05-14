#!/usr/bin/env python3
"""Localhost picker for Claude Code transcripts.

Spawns an HTTP server on ``127.0.0.1:<port>`` (default 9849) that lists every
``~/.claude/projects/*/<session-uuid>.jsonl`` and lets the user pick one. On pick,
the server invokes ``get-one-claude-code-transcript`` and writes a
``transcript.json`` to a fresh tmp dir, then surfaces the path.

Privacy contract: localhost binding only, no upload endpoint, response bodies are
secret-redacted before reaching the browser (via the same patterns used to build
the OT document itself).

Usage:
    python main.py                # serve on 127.0.0.1:9849
    python main.py --port 9850
    python main.py --no-browser   # don't auto-open
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import socketserver
import subprocess
import sys
import threading
import urllib.parse
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from _lib.cc_jsonl import list_sessions  # noqa: E402
from _lib.redaction import redact  # noqa: E402

UI_HTML = Path(__file__).with_name("ui.html")
GET_ONE = Path(__file__).resolve().parent.parent / "get-one-claude-code-transcript" / "main.py"


def _project_label(slug: str) -> str:
    """Make CC's mangled project slug readable: leading dashes back to slashes."""
    if not slug:
        return slug
    if slug.startswith("-"):
        return "/" + slug[1:].replace("-", "/")
    return slug


def _payload_for_listing() -> dict:
    sessions = list_sessions()
    items = []
    for s in sessions:
        items.append(
            {
                "session_id": s["session_id"],
                "project_slug": s["project_slug"],
                "project_label": _project_label(s["project_slug"]),
                "size_bytes": s["size_bytes"],
                "mtime": s["mtime"],
                "jsonl_path": s["jsonl_path"],
            }
        )
    return {"sessions": items}


class Handler(http.server.SimpleHTTPRequestHandler):
    """Serves three routes: ``/`` (UI), ``/api/sessions`` (JSON), ``/api/analyze`` (POST)."""

    server_version = "agent-transcript-analysis/0.1"

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default
        sys.stderr.write(f"[ui] {fmt % args}\n")

    def _send_json(self, status: int, body: dict) -> None:
        payload = json.dumps(redact(body), ensure_ascii=False).encode("utf-8")
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
        if parsed.path == "/api/sessions":
            self._send_json(200, _payload_for_listing())
            return
        self.send_error(404, "not found")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/analyze":
            self.send_error(404, "not found")
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {"error": "invalid JSON"})
            return
        session_id = body.get("session_id")
        if not isinstance(session_id, str) or "/" in session_id or "\\" in session_id:
            self._send_json(400, {"error": "missing or invalid session_id"})
            return
        try:
            proc = subprocess.run(
                [sys.executable, str(GET_ONE), session_id],
                capture_output=True,
                text=True,
                timeout=300,
            )
        except subprocess.TimeoutExpired:
            self._send_json(504, {"error": "transform timed out"})
            return
        if proc.returncode != 0:
            self._send_json(
                500,
                {"error": "transform failed", "stderr": proc.stderr[-2000:]},
            )
            return
        out_dir = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""
        self._send_json(200, {"out_dir": out_dir, "session_id": session_id})


def _serve(port: int) -> int:
    addr = ("127.0.0.1", port)
    httpd = socketserver.ThreadingTCPServer(addr, Handler)
    httpd.allow_reuse_address = True
    return port, httpd


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--port", type=int, default=int(os.environ.get("ATA_PORT", "9849")))
    p.add_argument("--no-browser", action="store_true")
    args = p.parse_args(argv)

    port, httpd = _serve(args.port)
    url = f"http://127.0.0.1:{port}/"
    print(f"listing UI on {url}", flush=True)
    if not args.no_browser:
        # Best-effort browser launch; on a remote/headless host this is a no-op.
        threading.Thread(target=lambda: webbrowser.open(url), daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("shutting down", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
