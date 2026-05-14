#!/usr/bin/env python3
"""Localhost picker for Claude Code transcripts.

Spawns an HTTP server on ``127.0.0.1:<port>`` (default 9849) that lists every
``~/.claude/projects/*/<session-uuid>.jsonl`` and lets the user copy session id(s)
to hand off to a Claude Code agent. The agent does the actual analysis (Skills
can only be invoked by an agent, not by an HTTP button).

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
import sys
import threading
import urllib.parse
import webbrowser
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from _lib.cc_jsonl import iter_jsonl, list_sessions  # noqa: E402
from _lib.redaction import redact, redact_string  # noqa: E402

UI_HTML = Path(__file__).with_name("ui.html")

PREVIEW_CACHE: dict[tuple[str, float], dict[str, Any]] = {}
PREVIEW_MAX_CHARS = 200


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


def _text_from_blocks(blocks: Any) -> str:
    """Concatenate the ``text`` of every ``text``/``thinking`` block found."""
    if isinstance(blocks, str):
        return blocks
    if not isinstance(blocks, list):
        return ""
    parts: list[str] = []
    for b in blocks:
        if not isinstance(b, dict):
            continue
        t = b.get("type")
        if t == "text" and isinstance(b.get("text"), str):
            parts.append(b["text"])
    return "\n".join(parts).strip()


def _short(s: str, limit: int = PREVIEW_MAX_CHARS) -> str:
    s = " ".join(s.split())
    if len(s) <= limit:
        return s
    return s[: limit - 1].rstrip() + "…"


def _build_preview(jsonl_path: Path) -> dict[str, Any]:
    """Walk the JSONL once, extract:

    - ``first_prompt``: text of the first ``user`` line whose content is not a tool_result.
    - ``last_response``: text of the last ``assistant`` line that has text content.
    - ``started_at`` / ``ended_at``: first and last timestamps seen.
    - ``message_count``: number of user/assistant messages (rough size signal).
    """
    first_prompt = ""
    last_response = ""
    started_at: str | None = None
    ended_at: str | None = None
    message_count = 0

    try:
        for line in iter_jsonl(jsonl_path):
            ts = line.get("timestamp")
            if isinstance(ts, str):
                if started_at is None:
                    started_at = ts
                ended_at = ts
            line_type = line.get("type")
            msg = line.get("message") if isinstance(line.get("message"), dict) else {}
            content = msg.get("content") if isinstance(msg, dict) else None

            if line_type == "user":
                if isinstance(content, list) and any(
                    isinstance(b, dict) and b.get("type") == "tool_result" for b in content
                ):
                    continue
                text = _text_from_blocks(content)
                if text and not first_prompt:
                    first_prompt = text
                if text:
                    message_count += 1
            elif line_type == "assistant":
                text = _text_from_blocks(content)
                if text:
                    last_response = text
                    message_count += 1
    except OSError as e:
        return {"error": f"read failed: {e}"}

    return {
        "first_prompt": _short(redact_string(first_prompt)),
        "last_response": _short(redact_string(last_response)),
        "started_at": started_at,
        "ended_at": ended_at,
        "message_count": message_count,
    }


def _preview_for(session_id: str) -> dict[str, Any] | None:
    """Find the JSONL for ``session_id`` and return its preview (cached by mtime)."""
    matches = [s for s in list_sessions() if s["session_id"] == session_id]
    if not matches:
        return None
    matches.sort(key=lambda s: s["mtime"], reverse=True)
    src = matches[0]
    jsonl = Path(src["jsonl_path"])
    cache_key = (session_id, src["mtime"])
    if cache_key in PREVIEW_CACHE:
        return PREVIEW_CACHE[cache_key]
    preview = _build_preview(jsonl)
    PREVIEW_CACHE[cache_key] = preview
    return preview


class Handler(http.server.SimpleHTTPRequestHandler):
    """Serves three routes: ``/`` (UI), ``/api/sessions`` (list),
    ``/api/sessions/<id>/preview`` (per-session snippet)."""

    server_version = "agent-transcript-analysis/0.1"

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default
        sys.stderr.write(f"[ui] {fmt % args}\n")

    def _send_json(self, status: int, body: dict, *, already_redacted: bool = False) -> None:
        payload = json.dumps(body if already_redacted else redact(body), ensure_ascii=False).encode(
            "utf-8"
        )
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
        if parsed.path.startswith("/api/sessions/") and parsed.path.endswith("/preview"):
            session_id = parsed.path[len("/api/sessions/") : -len("/preview")]
            if "/" in session_id or "\\" in session_id or not session_id:
                self._send_json(400, {"error": "invalid session_id"})
                return
            preview = _preview_for(session_id)
            if preview is None:
                self._send_json(404, {"error": "session not found"})
                return
            self._send_json(200, preview, already_redacted=True)
            return
        self.send_error(404, "not found")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--port", type=int, default=int(os.environ.get("ATA_PORT", "9849")))
    p.add_argument("--no-browser", action="store_true")
    args = p.parse_args(argv)

    addr = ("127.0.0.1", args.port)
    httpd = socketserver.ThreadingTCPServer(addr, Handler)
    httpd.allow_reuse_address = True
    url = f"http://127.0.0.1:{args.port}/"
    print(f"listing UI on {url}", flush=True)
    print(
        "pick a session → copy its id → ask Claude Code to analyze it with the "
        "analyze-agent-transcript skill",
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
