"""Reusable localhost review server for tier-4 findings.

This is the engine behind the plugin's "one unified review UI, re-used across
every category" design. The review skill (`review-analysis`) is a thin wrapper:
it picks a `tmp_dir` and a `kind` and calls `serve()`. The server, the static UI
(`review_ui.html`), and the provenance contract (`review.py`) are all shared —
a new reviewable category (a future tier-5 report reviewer, say) needs *no new
server code and no new UI*, only a `kind` string.

Privacy contract (identical to the rest of the plugin): localhost binding only,
no upload endpoint, every string secret-redacted before it reaches the browser
or disk (the redaction on disk happens in `review.write_reviewed`; drafts read
here are already redacted at produce time).

Endpoints:
- ``GET  /``            → ``review_ui.html``
- ``GET  /api/bundle``  → ``{findings, kind, source, existing_log, tmp_dir,
                            warnings}``
- ``POST /api/save``    → body ``{doc, log, base?, reviewer?}`` → writes
                          ``findings.<kind>.reviewed.json``; returns
                          ``{ok, path, warnings, log_size, verdict_counts}``
"""

from __future__ import annotations

import http.server
import json
import socketserver
import sys
import threading
import urllib.parse
import webbrowser
from pathlib import Path
from typing import Any

# review_server.py lives in _lib/; importable whether the caller put _lib's
# parent on sys.path as a package root or imports `_lib.review` directly.
try:
    from .review import load_review_bundle, validate_findings, write_reviewed
except ImportError:  # pragma: no cover - direct-script fallback
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from _lib.review import load_review_bundle, validate_findings, write_reviewed

UI_HTML = Path(__file__).with_name("review_ui.html")

DEFAULT_PORT = 9852


def _make_handler(tmp_dir: Path, kind: str, title: str) -> type:
    """Build a request handler bound to one tmp_dir + findings kind."""

    class Handler(http.server.SimpleHTTPRequestHandler):
        server_version = "agent-transcript-analysis-review/0.1"

        def log_message(self, fmt: str, *args: Any) -> None:  # quieter default
            sys.stderr.write(f"[review:{kind}] {fmt % args}\n")

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
                    self.send_error(500, "review_ui.html missing")
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
                    bundle = load_review_bundle(tmp_dir, kind)
                except FileNotFoundError as e:
                    self._send_json(404, {"error": str(e)})
                    return
                except (OSError, json.JSONDecodeError) as e:
                    self._send_json(500, {"error": f"failed to load bundle: {e}"})
                    return
                # surface validation warnings up front so the reviewer sees
                # what the envelope got wrong before they start.
                bundle["warnings"] = validate_findings(bundle["findings"])
                bundle["title"] = title
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

            doc = body.get("doc")
            log = body.get("log", [])
            base = body.get("base", "draft")
            reviewer = body.get("reviewer") or "user"
            if not isinstance(doc, dict):
                self._send_json(400, {"error": "body.doc must be the findings document"})
                return
            if not isinstance(log, list):
                self._send_json(400, {"error": "body.log must be a list"})
                return

            try:
                result = write_reviewed(
                    tmp_dir, kind, doc, log, reviewer=str(reviewer), base=str(base)
                )
            except (OSError, ValueError) as e:
                self._send_json(500, {"error": f"failed to write reviewed file: {e}"})
                return
            self._send_json(200, {"ok": True, **result})

    return Handler


def serve(
    tmp_dir: str | Path,
    kind: str,
    *,
    port: int = DEFAULT_PORT,
    open_browser: bool = True,
    title: str | None = None,
) -> int:
    """Start the localhost review server for one findings bucket.

    ``tmp_dir`` must contain ``findings.<kind>.json`` (or an existing
    ``findings.<kind>.reviewed.json`` to keep iterating). Blocks until
    interrupted. Returns a process exit code.
    """
    tmp = Path(tmp_dir).expanduser().resolve()
    if not tmp.is_dir():
        print(f"error: tmp_dir {tmp} is not a directory", file=sys.stderr)
        return 2
    from .review import draft_filename, reviewed_filename

    if not (tmp / draft_filename(kind)).exists() and not (
        tmp / reviewed_filename(kind)
    ).exists():
        print(
            f"error: {tmp} has no {draft_filename(kind)} or "
            f"{reviewed_filename(kind)} — produce the {kind!r} findings first",
            file=sys.stderr,
        )
        return 2

    label = title or f"{kind} findings"

    # allow_reuse_address must be a class attribute: ThreadingTCPServer.__init__
    # binds inline, so setting it on the instance afterward is a no-op and
    # leaves quick restarts hitting TIME_WAIT.
    class _Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True

    httpd = _Server(("127.0.0.1", port), _make_handler(tmp, kind, label))
    url = f"http://127.0.0.1:{port}/"
    print(f"review UI for {label} in {tmp} on {url}", flush=True)
    print(
        f"thumbs-up / correct each finding → Save writes "
        f"{reviewed_filename(kind)} (the draft is never touched)",
        flush=True,
    )
    if open_browser:
        threading.Thread(target=lambda: webbrowser.open(url), daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("shutting down", flush=True)
    finally:
        httpd.server_close()
    return 0


__all__ = ["serve", "DEFAULT_PORT"]
