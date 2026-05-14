"""OpenTranscripts v0.1 builders — turn a parsed CC session into an OT Transcript.

Spec: see ``references/open-transcripts/schemas/{transcript,events}.md`` and the
field-by-field CC → OT mapping in ``references/open-transcripts/mappings/claude-code.md``.

Conventions enforced here:
- Empty optional fields are omitted (not ``undefined``).
- Lists are always ``[]`` when empty.
- ``provider_raw`` carries the original CC line, redacted, minus fields hoisted to base.
- Event ids are stable: the CC line uuid for the first event from a line, and
  ``<uuid>:thinking:N`` / ``<uuid>:tool:N`` / ``<uuid>:spawn:N`` for sub-events when
  one CC assistant line expands into multiple OT events.
"""

from __future__ import annotations

from typing import Any

from .cc_jsonl import ParsedSession, ParsedSubagent
from .redaction import redact

SCHEMA_VERSION = "0.1"


def _content_parts_from_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map CC content blocks to OT ContentPart[]. Only text + image blocks come through;
    tool_use / tool_result / thinking blocks are promoted to their own events upstream."""
    parts: list[dict[str, Any]] = []
    for b in blocks:
        if not isinstance(b, dict):
            continue
        t = b.get("type")
        if t == "text":
            parts.append({"type": "text", "text": b.get("text", "")})
        elif t == "image":
            src = b.get("source") or {}
            parts.append(
                {
                    "type": "image",
                    "data": src.get("data", ""),
                    "mime_type": src.get("media_type") or src.get("mime_type", ""),
                }
            )
    return parts


def _redact_line(line: dict[str, Any]) -> dict[str, Any]:
    """Strip CC fields hoisted to OT base (id, parent_id, ts), then redact the rest."""
    cleaned = {k: v for k, v in line.items() if k not in ("uuid", "parentUuid", "timestamp")}
    return redact(cleaned)


def _usage_from_assistant(message: dict[str, Any]) -> dict[str, Any] | None:
    usage = message.get("usage")
    if not isinstance(usage, dict):
        return None
    return {
        "input_tokens": usage.get("input_tokens", 0),
        "output_tokens": usage.get("output_tokens", 0),
        "cache_read_tokens": usage.get("cache_read_input_tokens"),
        "cache_write_tokens": usage.get("cache_creation_input_tokens"),
    }


def _base_event(
    line: dict[str, Any],
    event_type: str,
    *,
    id_suffix: str = "",
    parent_override: str | None = None,
) -> dict[str, Any]:
    line_uuid = line.get("uuid") or ""
    event_id = f"{line_uuid}{':' + id_suffix if id_suffix else ''}"
    return {
        "id": event_id,
        "parent_id": parent_override if parent_override is not None else line.get("parentUuid"),
        "ts": line.get("timestamp"),
        "type": event_type,
    }


def _lines_to_events(
    lines: list[dict[str, Any]],
    subagents_by_tool_use_id: dict[str, str],
    subagent_meta_by_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Walk CC lines and emit OT events. Multiple events per assistant line when it
    contains thinking/tool_use/Task blocks."""
    events: list[dict[str, Any]] = []
    for line in lines:
        line_type = line.get("type")
        message = line.get("message")
        if not isinstance(message, dict):
            message = {}
        raw_content = message.get("content")
        blocks: list[dict[str, Any]]
        if isinstance(raw_content, list):
            blocks = [b for b in raw_content if isinstance(b, dict)]
        elif isinstance(raw_content, str):
            blocks = [{"type": "text", "text": raw_content}]
        else:
            blocks = []

        if line_type == "user":
            # Either a regular UserMessage or one or more ToolResults — never both.
            tool_results = [b for b in blocks if b.get("type") == "tool_result"]
            if tool_results:
                tur = line.get("toolUseResult")
                for i, b in enumerate(tool_results):
                    suffix = "" if i == 0 else f"toolresult:{i}"
                    evt = _base_event(line, "ToolResult", id_suffix=suffix)
                    raw_output = b.get("content")
                    if isinstance(raw_output, str):
                        output = [{"type": "text", "text": raw_output}]
                    elif isinstance(raw_output, list):
                        output = _content_parts_from_blocks(raw_output) or [
                            {"type": "text", "text": str(raw_output)}
                        ]
                    else:
                        output = []
                    evt["tool_call_id"] = b.get("tool_use_id", "")
                    evt["output"] = redact(output)
                    evt["is_error"] = bool(b.get("is_error", False))
                    evt["provider_raw"] = _redact_line(
                        {**line, "_toolUseResult": tur} if tur is not None else line
                    )
                    events.append(evt)
            else:
                evt = _base_event(line, "UserMessage")
                evt["content"] = redact(_content_parts_from_blocks(blocks))
                evt["provider_raw"] = _redact_line(line)
                events.append(evt)

        elif line_type == "assistant":
            text_blocks = [b for b in blocks if b.get("type") == "text"]
            thinking_blocks = [b for b in blocks if b.get("type") == "thinking"]
            tool_use_blocks = [b for b in blocks if b.get("type") == "tool_use"]

            # Always emit the AssistantMessage (carries the text content + usage + stop_reason).
            am = _base_event(line, "AssistantMessage")
            am["content"] = redact(_content_parts_from_blocks(text_blocks))
            am["model"] = message.get("model")
            am["stop_reason"] = message.get("stop_reason")
            usage = _usage_from_assistant(message)
            if usage is not None:
                am["usage"] = usage
            am["cost_usd"] = None
            am["provider_raw"] = _redact_line(line)
            events.append(am)
            am_id = am["id"]

            for i, b in enumerate(thinking_blocks):
                t = _base_event(line, "Thinking", id_suffix=f"thinking:{i}", parent_override=am_id)
                t["text"] = redact(b.get("thinking", b.get("text", "")))
                t["signature"] = b.get("signature")
                t["redacted"] = b.get("type") == "redacted_thinking" or bool(b.get("redacted", False))
                t["provider_raw"] = None
                events.append(t)

            for i, b in enumerate(tool_use_blocks):
                call = _base_event(line, "ToolCall", id_suffix=f"tool:{i}", parent_override=am_id)
                tool_use_id = b.get("id", "")
                call["tool_call_id"] = tool_use_id
                call["tool_name"] = b.get("name", "")
                call["arguments"] = redact(b.get("input", {}))
                call["provider_raw"] = None
                events.append(call)

                if b.get("name") in ("Task", "Agent"):
                    inp = b.get("input") or {}
                    spawn = _base_event(line, "SubagentSpawn", id_suffix=f"spawn:{i}", parent_override=am_id)
                    spawn["tool_call_id"] = tool_use_id
                    spawned_agent_id = subagents_by_tool_use_id.get(tool_use_id)
                    spawn["spawned_transcript_id"] = spawned_agent_id
                    meta = subagent_meta_by_id.get(spawned_agent_id or "", {})
                    spawn["subagent_type"] = meta.get("agent_type") or inp.get("subagent_type")
                    spawn["description"] = meta.get("description") or inp.get("description")
                    spawn["prompt"] = redact(inp.get("prompt", ""))
                    spawn["provider_raw"] = None
                    events.append(spawn)

        elif line_type == "system":
            text = ""
            if isinstance(message, dict):
                content_val = message.get("content")
                if isinstance(content_val, str):
                    text = content_val
                elif isinstance(content_val, list):
                    text = " ".join(
                        b.get("text", "") for b in content_val if isinstance(b, dict)
                    )
            looks_like_error = isinstance(text, str) and (
                text.startswith("API Error") or "error" in text.lower()[:200]
            )
            if looks_like_error:
                evt = _base_event(line, "Error")
                evt["code"] = None
                evt["message"] = redact(text)
                evt["recoverable"] = True
                evt["related_event_id"] = None
                evt["provider_raw"] = _redact_line(line)
            else:
                evt = _base_event(line, "SystemEvent")
                evt["subtype"] = "system"
                evt["payload"] = _redact_line(line)
                evt["provider_raw"] = None
            events.append(evt)

        else:
            # Any unrecognized line type → SystemEvent with subtype = the line's type.
            evt = _base_event(line, "SystemEvent")
            evt["subtype"] = str(line_type) if line_type else "unknown"
            evt["payload"] = _redact_line(line)
            evt["provider_raw"] = None
            events.append(evt)

    return events


def _final_metrics(events: list[dict[str, Any]], subagents: list[dict[str, Any]]) -> dict[str, Any]:
    in_tot = 0
    out_tot = 0
    for e in events:
        if e.get("type") == "AssistantMessage":
            u = e.get("usage") or {}
            in_tot += int(u.get("input_tokens") or 0)
            out_tot += int(u.get("output_tokens") or 0)
    for sub in subagents:
        m = sub.get("final_metrics") or {}
        in_tot += int(m.get("total_tokens_in") or 0)
        out_tot += int(m.get("total_tokens_out") or 0)

    created = None
    ended = None
    walk_targets = [events] + [sub.get("events") or [] for sub in subagents]
    for evs in walk_targets:
        if not evs:
            continue
        first_ts = evs[0].get("ts")
        last_ts = evs[-1].get("ts")
        if first_ts and (created is None or first_ts < created):
            created = first_ts
        if last_ts and (ended is None or last_ts > ended):
            ended = last_ts

    wall = 0
    if created and ended:
        try:
            from datetime import datetime

            def _parse(t: str) -> datetime:
                return datetime.fromisoformat(t.replace("Z", "+00:00"))

            wall = max(0, int((_parse(ended) - _parse(created)).total_seconds()))
        except (ValueError, TypeError):
            wall = 0

    return {
        "total_tokens_in": in_tot,
        "total_tokens_out": out_tot,
        "cost_usd": None,
        "wall_clock_s": wall,
    }


def build_transcript(
    lines: list[dict[str, Any]],
    *,
    transcript_id: str,
    parent: dict[str, str] | None,
    subagent_transcripts: list[dict[str, Any]],
    subagents_by_tool_use_id: dict[str, str],
    subagent_meta_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Assemble one OT Transcript document from a list of CC JSONL lines + already-built
    child transcripts."""
    if not lines:
        first_line = {}
    else:
        first_line = lines[0]
    last_line = lines[-1] if lines else {}

    def _first(field: str) -> Any:
        for ln in lines:
            v = ln.get(field)
            if v is not None and v != "":
                return v
        return None

    cwd = _first("cwd")
    version = _first("version")
    created = first_line.get("timestamp") or _first("timestamp")
    ended = last_line.get("timestamp") or created

    model_default = None
    for line in lines:
        if line.get("type") == "assistant":
            msg = line.get("message")
            if isinstance(msg, dict) and isinstance(msg.get("model"), str):
                model_default = msg["model"]
                break

    events = _lines_to_events(lines, subagents_by_tool_use_id, subagent_meta_by_id)

    unmapped_lines: list[dict[str, Any]] = []
    for line, evt in zip(lines, events):
        if evt.get("type") == "SystemEvent" and evt.get("subtype") not in (None, "", "system"):
            unmapped_lines.append(redact(line))

    transcript: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "transcript_id": transcript_id,
        "parent": parent,
        "agent": {
            "name": "claude-code",
            "version": version,
            "model_default": model_default,
        },
        "cwd": cwd,
        "created_at": created,
        "ended_at": ended,
        "events": events,
        "subagents": subagent_transcripts,
        "final_metrics": _final_metrics(events, subagent_transcripts),
        "provider": {
            "vendor": "claude-code",
            "vendor_version": version,
            "raw": {"unmapped_lines": unmapped_lines} if unmapped_lines else None,
        },
    }
    return transcript


def session_to_transcript(session: ParsedSession) -> dict[str, Any]:
    """Top-level: turn a fully parsed CC session (parent + subagents) into one OT Transcript."""
    subagents_by_tool_use_id = {
        sub.ref.spawn_tool_use_id: sub.ref.agent_id
        for sub in session.subagents
        if sub.ref.spawn_tool_use_id
    }
    subagent_meta_by_id = {
        sub.ref.agent_id: {
            "agent_type": sub.ref.agent_type,
            "description": sub.ref.description,
        }
        for sub in session.subagents
    }

    spawn_event_lookup_built = False
    spawn_event_by_agent_id: dict[str, str] = {}

    def _resolve_spawn_event_for(parent_events: list[dict[str, Any]]) -> None:
        nonlocal spawn_event_lookup_built
        if spawn_event_lookup_built:
            return
        for evt in parent_events:
            if evt.get("type") == "SubagentSpawn":
                agent_id = evt.get("spawned_transcript_id")
                if agent_id:
                    spawn_event_by_agent_id[agent_id] = evt["id"]
        spawn_event_lookup_built = True

    # Build subagents first (recursive: but in CC we only have one level via ParsedSession;
    # nested subagents would be discoverable from the subagent JSONL itself, so we recurse
    # if any subagent line carries Task calls of its own).
    child_transcripts: list[dict[str, Any]] = []

    parent_events_preview = _lines_to_events(
        session.parent_lines, subagents_by_tool_use_id, subagent_meta_by_id
    )
    _resolve_spawn_event_for(parent_events_preview)

    for sub in session.subagents:
        nested = _build_nested_session_from_subagent(sub)
        nested_transcript = session_to_transcript(nested) if nested.subagents else _build_leaf_subagent_transcript(sub)
        nested_transcript["parent"] = {
            "transcript_id": session.session_id,
            "spawn_event_id": spawn_event_by_agent_id.get(sub.ref.agent_id, ""),
        }
        child_transcripts.append(nested_transcript)

    return build_transcript(
        session.parent_lines,
        transcript_id=session.session_id,
        parent=None,
        subagent_transcripts=child_transcripts,
        subagents_by_tool_use_id=subagents_by_tool_use_id,
        subagent_meta_by_id=subagent_meta_by_id,
    )


def _build_leaf_subagent_transcript(sub: ParsedSubagent) -> dict[str, Any]:
    """Build an OT Transcript for a subagent that doesn't spawn its own subagents."""
    return build_transcript(
        sub.lines,
        transcript_id=sub.ref.agent_id,
        parent=None,  # caller fills this in
        subagent_transcripts=[],
        subagents_by_tool_use_id={},
        subagent_meta_by_id={},
    )


def _build_nested_session_from_subagent(sub: ParsedSubagent) -> ParsedSession:
    """Wrap a ParsedSubagent's lines back into a ParsedSession so the recursive
    session_to_transcript() can discover nested subagent spawns within it."""
    nested = ParsedSession(
        session_id=sub.ref.agent_id,
        jsonl_path=sub.ref.jsonl_path,
        sidecar_dir=None,
        parent_lines=sub.lines,
        subagents=[],
    )
    # Nested subagents: if the subagent JSONL contains Task tool_uses with matching
    # subagent files on disk, walk them. For v0.1 we keep this best-effort.
    from .cc_jsonl import discover_subagents, iter_jsonl

    try:
        for ref in discover_subagents(sub.ref.jsonl_path):
            nested.subagents.append(
                ParsedSubagent(ref=ref, lines=list(iter_jsonl(ref.jsonl_path)))
            )
    except Exception:
        pass
    return nested


__all__ = ["session_to_transcript", "build_transcript", "SCHEMA_VERSION"]
