#!/usr/bin/env python3
"""Localhost picker for Claude Code transcripts.

Spawns an HTTP server on ``127.0.0.1:<port>`` (default 9849) that lists every
``~/.claude/projects/*/<session-uuid>.jsonl`` and lets the user copy session id(s)
to hand off to a Claude Code agent. The agent does the actual analysis (Skills
can only be invoked by an agent, not by an HTTP button).

The server builds a full preview index in a background thread pool on startup
and persists it to ``~/.cache/agent-transcript-analysis/preview-index-v1.json``
so subsequent runs warm up instantly. With the index in place, filtering and
sorting (by turns, tokens, branch, etc.) all happen on the already-hydrated
client snapshot — no per-row HTTP round-trips.

Privacy contract: localhost binding only, no upload endpoint, response bodies
are secret-redacted before they reach the browser or the disk cache.

Usage:
    python main.py                # serve on 127.0.0.1:9849
    python main.py --port 9850
    python main.py --no-browser   # don't auto-open
    python main.py --workers 16   # tune index parallelism (default 8)
"""

from __future__ import annotations

import argparse
import atexit
import gzip
import http.server
import json
import os
import socketserver
import sys
import threading
import time
import urllib.parse
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from _lib.cc_jsonl import iter_jsonl, list_sessions  # noqa: E402
from _lib.redaction import redact_string  # noqa: E402

UI_HTML = Path(__file__).with_name("ui.html")

PREVIEW_MAX_CHARS = 200
CACHE_VERSION = 1
CACHE_DIR = Path.home() / ".cache" / "agent-transcript-analysis"
CACHE_FILE = CACHE_DIR / f"preview-index-v{CACHE_VERSION}.json"

# Locked, in-memory mirror of the on-disk preview index. Keyed by
# ``"<jsonl_path>:<mtime>"`` so any append to a session JSONL invalidates the
# entry deterministically.
INDEX_LOCK = threading.Lock()
INDEX: dict[str, dict[str, Any]] = {}
INDEX_DIRTY = 0
# Set once the on-disk cache has been read in. Until then a flush would write
# an incomplete (often empty) snapshot over a good cache — e.g. if the process
# dies during startup before bootstrap finishes ``json.load``-ing the file.
INDEX_LOADED = False
INDEX_STATE: dict[str, Any] = {
    "indexed": 0,
    "total": 0,
    "started_at": None,
    "completed_at": None,
}
INDEX_INFLIGHT: set[str] = set()  # cache_keys currently being indexed by a worker
INDEX_EXECUTOR: ThreadPoolExecutor | None = None  # persistent pool for ad-hoc indexing

# path → (mtime, cache_key) of the most recent successful index for that file.
# Lets the listing fall back to slightly-stale stats when a session is being
# actively written (its mtime moves faster than we can reindex).
INDEX_LATEST_BY_PATH: dict[str, tuple[float, str]] = {}


def _cache_key(jsonl_path: str, mtime: float) -> str:
    return f"{jsonl_path}:{mtime}"


def _project_label(slug: str) -> str:
    """Make CC's mangled project slug readable: leading dashes back to slashes."""
    if not slug:
        return slug
    if slug.startswith("-"):
        return "/" + slug[1:].replace("-", "/")
    return slug


def _text_from_blocks(blocks: Any) -> str:
    """Concatenate the ``text`` of every ``text`` block found."""
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
    """Walk a JSONL once and return a compact preview record.

    All string fields are redacted before being returned, so the result is
    safe to cache to disk and to ship to the browser as-is.
    """
    first_prompt = ""
    last_response = ""
    started_at: str | None = None
    ended_at: str | None = None
    user_turns = 0
    assistant_turns = 0
    input_tokens = 0
    output_tokens = 0
    cache_creation_tokens = 0
    cache_read_tokens = 0
    git_branch = ""
    model = ""

    try:
        for line in iter_jsonl(jsonl_path):
            ts = line.get("timestamp")
            if isinstance(ts, str):
                if started_at is None:
                    started_at = ts
                ended_at = ts

            if not git_branch:
                gb = line.get("gitBranch")
                if isinstance(gb, str) and gb:
                    git_branch = gb

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
                    user_turns += 1
            elif line_type == "assistant":
                assistant_turns += 1
                text = _text_from_blocks(content)
                if text:
                    last_response = text
                m = msg.get("model") if isinstance(msg, dict) else None
                if isinstance(m, str) and m:
                    model = m
                usage = msg.get("usage") if isinstance(msg, dict) else None
                if isinstance(usage, dict):
                    input_tokens += int(usage.get("input_tokens") or 0)
                    output_tokens += int(usage.get("output_tokens") or 0)
                    cache_creation_tokens += int(usage.get("cache_creation_input_tokens") or 0)
                    cache_read_tokens += int(usage.get("cache_read_input_tokens") or 0)
    except OSError as e:
        return {"error": f"read failed: {e}"}

    return {
        "first_prompt": _short(redact_string(first_prompt)),
        "last_response": _short(redact_string(last_response)),
        "started_at": started_at,
        "ended_at": ended_at,
        "user_turns": user_turns,
        "assistant_turns": assistant_turns,
        "message_count": user_turns + assistant_turns,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_creation_tokens": cache_creation_tokens,
        "cache_read_tokens": cache_read_tokens,
        "git_branch": redact_string(git_branch),
        "model": model,
    }


def _load_disk_cache() -> None:
    """Hydrate ``INDEX`` from the on-disk cache. Tolerates a corrupt/missing file."""
    global INDEX_LOADED
    try:
        if not CACHE_FILE.exists():
            return
        try:
            with CACHE_FILE.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(f"[index] cache load failed, starting clean: {e}", flush=True)
            return
        if not isinstance(data, dict):
            return
        with INDEX_LOCK:
            for k, v in data.items():
                if not (isinstance(k, str) and isinstance(v, dict)):
                    continue
                INDEX[k] = v
                path, _, mtime_str = k.rpartition(":")
                try:
                    mt = float(mtime_str)
                except ValueError:
                    continue
                prev = INDEX_LATEST_BY_PATH.get(path)
                if prev is None or mt > prev[0]:
                    INDEX_LATEST_BY_PATH[path] = (mt, k)
        print(f"[index] loaded {len(INDEX)} cached previews from {CACHE_FILE}", flush=True)
    finally:
        # Mark loaded even on the early-return paths (missing/corrupt file):
        # the load *attempt* is complete, so a subsequent flush is now safe.
        INDEX_LOADED = True


def _flush_disk_cache() -> None:
    """Atomically rewrite the on-disk cache from the current ``INDEX`` snapshot.

    Refuses to run before the on-disk cache has been read in, and refuses to
    write an empty snapshot — either case would clobber a good cache with
    nothing if the process exits during startup (port-bind failure, SIGTERM).
    """
    if not INDEX_LOADED:
        return
    with INDEX_LOCK:
        snapshot = dict(INDEX)
    if not snapshot:
        return
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CACHE_FILE.with_suffix(CACHE_FILE.suffix + ".tmp")
    try:
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False)
        tmp.replace(CACHE_FILE)
    except OSError as e:
        print(f"[index] flush failed: {e}", flush=True)


def _index_one(session: dict[str, Any], *, count: bool = True) -> None:
    """Build the preview for one session and store it in ``INDEX``.

    Set ``count=False`` for ad-hoc reindexes (active sessions whose mtime
    moved after startup) so progress numbers stay aligned with the
    bootstrap workload.
    """
    global INDEX_DIRTY
    key = _cache_key(session["jsonl_path"], session["mtime"])
    try:
        preview = _build_preview(Path(session["jsonl_path"]))
    finally:
        with INDEX_LOCK:
            INDEX_INFLIGHT.discard(key)
    with INDEX_LOCK:
        INDEX[key] = preview
        prev = INDEX_LATEST_BY_PATH.get(session["jsonl_path"])
        if prev is None or session["mtime"] > prev[0]:
            INDEX_LATEST_BY_PATH[session["jsonl_path"]] = (session["mtime"], key)
        if count:
            INDEX_STATE["indexed"] += 1
        INDEX_DIRTY += 1


def _schedule_reindex(session: dict[str, Any]) -> None:
    """If this session isn't indexed (or in flight), submit a build job."""
    if INDEX_EXECUTOR is None:
        return
    key = _cache_key(session["jsonl_path"], session["mtime"])
    with INDEX_LOCK:
        if key in INDEX or key in INDEX_INFLIGHT:
            return
        INDEX_INFLIGHT.add(key)
    INDEX_EXECUTOR.submit(_index_one, session, count=False)


def _flusher_loop() -> None:
    """Background flusher: every few seconds, persist the cache if it changed."""
    global INDEX_DIRTY
    while True:
        time.sleep(6)
        with INDEX_LOCK:
            dirty = INDEX_DIRTY
            done = INDEX_STATE["completed_at"] is not None
        if dirty > 0:
            _flush_disk_cache()
            with INDEX_LOCK:
                INDEX_DIRTY = 0
        if done:
            return


def _start_indexing(workers: int) -> None:
    """Walk every session and submit it to a thread pool; cached entries skip.

    The pool stays alive after the initial sweep so ``_schedule_reindex`` can
    pick up sessions that appear or move (their mtime changes) later.
    """
    global INDEX_EXECUTOR
    _load_disk_cache()
    sessions = list_sessions()
    with INDEX_LOCK:
        INDEX_STATE["total"] = len(sessions)
        INDEX_STATE["started_at"] = time.time()
        cached_now = 0
        todo: list[dict[str, Any]] = []
        for s in sessions:
            key = _cache_key(s["jsonl_path"], s["mtime"])
            if key in INDEX:
                cached_now += 1
            else:
                todo.append(s)
                INDEX_INFLIGHT.add(key)
        INDEX_STATE["indexed"] = cached_now
    print(
        f"[index] {cached_now} cached, {len(todo)} to build (workers={workers})", flush=True
    )

    INDEX_EXECUTOR = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="index")
    threading.Thread(target=_flusher_loop, name="index-flusher", daemon=True).start()

    if not todo:
        with INDEX_LOCK:
            INDEX_STATE["completed_at"] = time.time()
        return

    futures = [INDEX_EXECUTOR.submit(_index_one, s) for s in todo]

    def _wait_done() -> None:
        for fut in futures:
            try:
                fut.result()
            except Exception as e:
                print(f"[index] worker raised: {e}", flush=True)
        with INDEX_LOCK:
            INDEX_STATE["completed_at"] = time.time()
            elapsed = INDEX_STATE["completed_at"] - INDEX_STATE["started_at"]
        _flush_disk_cache()
        print(f"[index] done in {elapsed:.1f}s, flushed to {CACHE_FILE}", flush=True)

    threading.Thread(target=_wait_done, name="index-waiter", daemon=True).start()


def _payload_for_listing() -> dict:
    """Build the full sessions payload, merging cached preview fields per row.

    Any session whose preview isn't in the index (new file, mtime moved since
    bootstrap) is scheduled for an opportunistic background reindex so that
    the next ``/api/sessions`` poll picks it up.
    """
    sessions = list_sessions()
    with INDEX_LOCK:
        snapshot = dict(INDEX)
        latest_by_path = dict(INDEX_LATEST_BY_PATH)
        progress = {
            "indexed": INDEX_STATE["indexed"],
            "total": INDEX_STATE["total"],
            "complete": INDEX_STATE["completed_at"] is not None,
        }
    items: list[dict[str, Any]] = []
    for s in sessions:
        key = _cache_key(s["jsonl_path"], s["mtime"])
        preview = snapshot.get(key)
        stale = False
        if preview is None:
            _schedule_reindex(s)
            # Active session: mtime keeps moving, so the exact key is rarely
            # in the cache. Fall back to the most-recent index for this path
            # so stats stay populated (just slightly behind the live file).
            latest = latest_by_path.get(s["jsonl_path"])
            if latest is not None:
                fallback = snapshot.get(latest[1])
                if fallback is not None and "error" not in fallback:
                    preview = fallback
                    stale = True
        item = {
            "session_id": s["session_id"],
            "project_slug": s["project_slug"],
            "project_label": _project_label(s["project_slug"]),
            "size_bytes": s["size_bytes"],
            "mtime": s["mtime"],
            "jsonl_path": s["jsonl_path"],
            "indexed": preview is not None and "error" not in preview,
            "indexed_stale": stale,
        }
        if preview and "error" not in preview:
            # Inline every preview field directly on the row so the client
            # can filter/sort without any further round-trips.
            for k in (
                "first_prompt",
                "last_response",
                "started_at",
                "ended_at",
                "user_turns",
                "assistant_turns",
                "message_count",
                "input_tokens",
                "output_tokens",
                "cache_creation_tokens",
                "cache_read_tokens",
                "git_branch",
                "model",
            ):
                if k in preview:
                    item[k] = preview[k]
        items.append(item)
    return {"sessions": items, "progress": progress}


def _preview_for(session_id: str) -> dict[str, Any] | None:
    """Synchronously return the preview for ``session_id``, falling back to a
    direct build if the indexer hasn't reached it yet. Mainly here so the
    legacy ``/api/sessions/<id>/preview`` endpoint keeps working."""
    matches = [s for s in list_sessions() if s["session_id"] == session_id]
    if not matches:
        return None
    matches.sort(key=lambda s: s["mtime"], reverse=True)
    src = matches[0]
    key = _cache_key(src["jsonl_path"], src["mtime"])
    with INDEX_LOCK:
        cached = INDEX.get(key)
    if cached is not None:
        return cached
    preview = _build_preview(Path(src["jsonl_path"]))
    with INDEX_LOCK:
        INDEX[key] = preview
    return preview


class Handler(http.server.SimpleHTTPRequestHandler):
    """Serves:

    - ``GET /``                          → ``ui.html``
    - ``GET /api/sessions``              → all sessions + merged preview fields
    - ``GET /api/progress``              → indexing progress (cheap polling)
    - ``GET /api/sessions/<id>/preview`` → legacy per-session preview
    """

    server_version = "agent-transcript-analysis/0.1"

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default
        sys.stderr.write(f"[ui] {fmt % args}\n")

    def _accepts_gzip(self) -> bool:
        ae = self.headers.get("Accept-Encoding", "")
        return "gzip" in ae.lower()

    def _send_json(self, status: int, body: dict) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        encoding = None
        if self._accepts_gzip() and len(payload) > 4096:
            payload = gzip.compress(payload, compresslevel=4)
            encoding = "gzip"
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if encoding:
            self.send_header("Content-Encoding", encoding)
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
        if parsed.path == "/api/progress":
            with INDEX_LOCK:
                self._send_json(
                    200,
                    {
                        "indexed": INDEX_STATE["indexed"],
                        "total": INDEX_STATE["total"],
                        "complete": INDEX_STATE["completed_at"] is not None,
                        "started_at": INDEX_STATE["started_at"],
                        "completed_at": INDEX_STATE["completed_at"],
                    },
                )
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
            self._send_json(200, preview)
            return
        self.send_error(404, "not found")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--port", type=int, default=int(os.environ.get("ATA_PORT", "9849")))
    p.add_argument("--no-browser", action="store_true")
    p.add_argument(
        "--workers", type=int, default=int(os.environ.get("ATA_INDEX_WORKERS", "8")),
        help="parallel JSONL workers for the background index (default 8)",
    )
    args = p.parse_args(argv)

    threading.Thread(
        target=_start_indexing, args=(args.workers,), name="index-bootstrap", daemon=True
    ).start()

    # allow_reuse_address must be set on the class before construction —
    # ThreadingTCPServer.__init__ calls server_bind() inline. Setting it on the
    # instance afterward is a no-op and leaves quick restarts hitting TIME_WAIT.
    class _Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True

    addr = ("127.0.0.1", args.port)
    httpd = _Server(addr, Handler)
    # Register the cache flush only once the server is actually up: a flush
    # triggered by a failed bind would race the still-loading bootstrap thread.
    atexit.register(_flush_disk_cache)
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
        _flush_disk_cache()
    return 0


if __name__ == "__main__":
    sys.exit(main())
