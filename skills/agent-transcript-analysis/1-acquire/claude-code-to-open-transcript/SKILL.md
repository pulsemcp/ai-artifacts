---
name: claude-code-to-open-transcript
description: >
  Deterministic transformation: given the path to a Claude Code session JSONL
  (and the project directory it lives in), produce a single OpenTranscripts
  `Transcript` JSON document — the main session plus every subagent linked
  via the canonical tool_use → tool_result → agentId chain. No LLM calls,
  no heuristics; pure field mapping per
  references/open-transcripts/mappings/claude-code.md. Use this skill from
  inside `get-one-claude-code-transcript`, or directly when you already have
  a JSONL path and want an OT Transcript out.
user-invocable: false
---

# Claude Code → OpenTranscripts

The deterministic CC → OT transformation. This skill owns the canonical mapping; everything else delegates here.

## Invocation

```
python skills/agent-transcript-analysis/1-acquire/claude-code-to-open-transcript/main.py \
    <path-to-session.jsonl> [--out <output.json>] [--pretty]
```

`main.py` is the reference implementation. It writes one OT `Transcript` document to `--out` (defaults to `transcript.json` next to the source JSONL). Subagents are auto-resolved from `<session-uuid>/subagents/agent-<id>.jsonl` (with legacy sibling-file fallback). Secret-redaction runs inline; no upload, no LLM.

## Inputs

- `main_jsonl_path` (required): absolute path to the main session JSONL (e.g. `~/.claude/projects/<project>/<session-uuid>.jsonl`).
- The CC sidecar dir at `<session-uuid>/subagents/` is auto-discovered next to the JSONL. No separate `project_dir` arg is needed.

## Output

A single OpenTranscripts `Transcript` JSON object printed to stdout (or written to a path if the caller provides one). The output conforms to:

- [`references/open-transcripts/schemas/transcript.md`](../../../../references/open-transcripts/schemas/transcript.md) — the wrapper.
- [`references/open-transcripts/schemas/events.md`](../../../../references/open-transcripts/schemas/events.md) — the event types.

Subagents are embedded recursively under `subagents[]`; their `parent` field is populated with `{ transcript_id, spawn_event_id }` pointing back to the `SubagentSpawn` event in the parent's `events[]`.

## What this skill does

The transformation has four passes:

### 1. Parse + redact

- Read the JSONL file line by line.
- Apply secret-redaction patterns to every string field **before** any further processing. Patterns are the ones from `pulsemcp/agentic-engineering-infra`'s `transcript-export/transcript-export.py` (API keys, AWS credentials, Stripe keys, bearer tokens, private keys, JWT-like strings, generic `*_SECRET=...` / `*_KEY=...` env-var spellings).
- Tally redaction counts by pattern for `run.log`.

### 2. Map each line to an OT Event

Per the line-by-line mapping in [`references/open-transcripts/mappings/claude-code.md`](../../../../references/open-transcripts/mappings/claude-code.md):

- `user` + text content blocks → `UserMessage` event.
- `user` + `tool_result` block → `ToolResult` event.
- `assistant` + text/thinking/tool_use blocks → emit one `AssistantMessage` for the text content, plus separate `Thinking` and `ToolCall` events for each thinking/tool_use block in the same line.
- `assistant` + `tool_use` with `name == "Task"` → emit both a `ToolCall` *and* a `SubagentSpawn` event. The `SubagentSpawn`'s `spawned_transcript_id` is resolved in pass 3.
- `system` lines with error payloads → `Error` event.
- Compaction markers (`isCompactSummary: true` or equivalent) → `Compaction` event.
- All other CC line types (`attachment`, `ai-title`, `last-prompt`, `queue-operation`, `permission-mode`, `pr-link`, `file-history-snapshot`, etc.) → `SystemEvent` with `subtype = <CC type>`.
- Anything wholly unrecognized → `SystemEvent` with `subtype = "unmapped"` *and* the original line appended to `provider.raw.unmapped_lines[]`.

### 3. Walk the subagent linkage chain

Build a map `tool_use.id → toolUseResult.agentId` by scanning the parent's lines for `Task` tool_uses and their matching `tool_result`s. For each entry:

- Locate `<project_dir>/<agentId>.jsonl`.
- Recursively call this transformation on it.
- Set the child Transcript's `parent` to `{ transcript_id: <parent's transcript_id>, spawn_event_id: <id of the parent's SubagentSpawn event for this tool_use_id> }`.
- Append the child to the parent's `subagents[]`.
- Patch the parent's `SubagentSpawn.spawned_transcript_id` to point at the child's `transcript_id`.

Subagents may themselves spawn subagents; the same recursion applies. No depth limit.

### 4. Assemble the Transcript wrapper

- `schema_version`: `"0.1"`.
- `transcript_id`: the session UUID (from the JSONL filename, minus `.jsonl`).
- `parent`: caller-supplied for child runs; `null` for the top-level main transcript.
- `agent.name`: `"claude-code"`.
- `agent.version`: the `version` field on the first line.
- `agent.model_default`: the `model` field on the first `assistant` line.
- `cwd`: the `cwd` field on the first line.
- `created_at` / `ended_at`: first and last line timestamps.
- `events`: the array built in pass 2, sorted by `ts` ascending; `parent_id` chained linearly within a Transcript.
- `subagents`: the array built in pass 3.
- `final_metrics`: roll-up totals across `events[*].usage` and all `subagents[*].final_metrics`.
- `provider.vendor`: `"claude-code"`.
- `provider.vendor_version`: same as `agent.version`.
- `provider.raw.unmapped_lines`: any line that didn't cleanly map.

## Sequencing checklist

- [ ] Validate `main_jsonl_path` exists and is readable.
- [ ] Read the JSONL line by line; apply secret-redaction before any further work.
- [ ] Pass 2: map each line to one or more OT events. Preserve original `uuid` as `id`, `parentUuid` as `parent_id`, `timestamp` as `ts`.
- [ ] Pass 3: build the `tool_use.id → agentId` map. For each spawn, recursively transform the child JSONL and link via `parent` + `SubagentSpawn.spawned_transcript_id`.
- [ ] Pass 4: assemble the wrapper, compute `final_metrics`, attach `provider`.
- [ ] Validate against the invariants in `transcript.md` ("Invariants a Transcript must satisfy"):
  - `events[]` sorted by `ts`.
  - Every `SubagentSpawn` has a matching entry in `subagents[]` (same level) and vice versa.
  - No `undefined`; optional fields are omitted or `null`.
- [ ] Print the Transcript JSON to stdout (or write to the caller-specified path).

## Implementation notes

- **No LLM, no heuristics.** This skill is deterministic. If the mapping is ambiguous, fix [`mappings/claude-code.md`](../../../../references/open-transcripts/mappings/claude-code.md) first, then this skill.
- **Recursion shares one redaction pass.** Read each JSONL once; don't re-redact per pass.
- **Streaming vs in-memory.** For session files under ~50 MB, build the whole event array in memory. Above that, stream the JSONL but still emit a single JSON document at the end — the wrapper composes better that way.
- **Reuse prior art.** The JSONL parser and redaction regexes come from `pulsemcp/agentic-engineering-infra`'s `transcript-export.py`; don't reinvent them.

## Out of scope

- Picking which session to transform — `find-all-claude-code-transcripts` / `get-one-claude-code-transcript` are upstream.
- Decomposing the Transcript into Segments — that's tier 2 (`decompose-into-transcript-segments`).
- Any analysis or scoring — all `analyze-*` skills are downstream of tier 2.

## Mapping maintenance contract

When Claude Code adds, renames, or removes a JSONL field:

1. Update [`references/open-transcripts/mappings/claude-code.md`](../../../../references/open-transcripts/mappings/claude-code.md) **first** to reflect the new shape.
2. Update this skill's transformation logic to match.
3. Update the example fixtures in [`references/open-transcripts/examples/`](../../../../references/open-transcripts/examples/) if a documented field shape changed.
4. If a CC field shape change forces a breaking change to OT itself, bump `schema_version` per the policy in [`references/open-transcripts/README.md`](../../../../references/open-transcripts/README.md).
