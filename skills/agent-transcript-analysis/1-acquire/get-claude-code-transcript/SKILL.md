---
name: get-claude-code-transcript
description: >
  Given a Claude Code session id (or a JSONL path), produce a single
  OpenTranscripts `transcript.json` — the main session plus every subagent it
  spawned, linked and nested in one self-contained JSON document. The CC →
  OpenTranscripts mapping is deterministic (no LLM, no heuristics) per the
  open-transcripts-claude-code-mapping reference, and secret-redaction runs
  inline. Use this skill after find-all-claude-code-transcripts (or when the
  session id is already known) and before any of the analyze-* skills. The
  output is a path to a tmp directory containing transcript.json conforming
  to the open-transcripts-transcript reference.
user-invocable: true
---

# Get Claude Code transcript

The acquisition step of the analysis pipeline: take a CC session id, gather the main JSONL plus every linked subagent JSONL, run the deterministic CC→OpenTranscripts transformation, and emit a single `transcript.json` ready for tier 2. This skill owns the canonical CC→OT mapping end to end — locating the session and transforming it are one job, not two.

## Invocation

```
python main.py <session-uuid> [--tmp-root <dir>] [--pretty]
python main.py --jsonl <path-to-session.jsonl> [--tmp-root <dir>] [--pretty]
```

`main.py` is the reference implementation. Given a session id, it scans `~/.claude/projects/*/<session-uuid>.jsonl`; given `--jsonl`, it transforms that file directly. Either way it writes the output dir to stdout. The output dir defaults to `$TMPDIR/transcript-analysis/<session-uuid>/`.

## Inputs

- `session_id` — the Claude Code session UUID. Resolved by scanning `~/.claude/projects/`; the most recently modified match wins.
- `--jsonl` — a JSONL path, used instead of a session id when you already have the file.
- `--tmp-root` (optional): override the tmp output root. Defaults to `$TMPDIR/transcript-analysis/`.

Exactly one of `session_id` / `--jsonl` is required.

## Output

A tmp directory containing:

```
transcript.json    # the OpenTranscripts Transcript document (redacted)
run.log            # acquisition run log: source, line/subagent/event counts, final metrics
```

`transcript.json` conforms to the `open-transcripts-transcript` reference (the wrapper) and the `open-transcripts-events` reference (events). Subagents are embedded recursively under `subagents[]`; nothing is left on disk that the consumer needs to re-link. The output path is written to stdout so downstream skills can consume it.

## What this skill does

The transformation has four passes:

### 1. Parse + redact

- Read the JSONL file line by line.
- Apply secret-redaction patterns to every string field **before** any further processing. Patterns are the ones from `pulsemcp/agentic-engineering-infra`'s `transcript-export.py` (API keys, AWS credentials, Stripe keys, bearer tokens, private keys, JWT-like strings, generic `*_SECRET=...` / `*_KEY=...` env-var spellings).
- Tally redaction counts by pattern for `run.log`.

### 2. Map each line to an OT Event

Per the line-by-line mapping in the `open-transcripts-claude-code-mapping` reference:

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

- Locate `<session-uuid>/subagents/agent-<agentId>.jsonl` (with legacy sibling-file fallback).
- Recursively run the transformation on it.
- Set the child Transcript's `parent` to `{ transcript_id: <parent's transcript_id>, spawn_event_id: <id of the parent's SubagentSpawn event for this tool_use_id> }`.
- Append the child to the parent's `subagents[]`.
- Patch the parent's `SubagentSpawn.spawned_transcript_id` to point at the child's `transcript_id`.

Subagents may themselves spawn subagents; the same recursion applies. No depth limit.

### 4. Assemble the Transcript wrapper

- `schema_version`: `"0.1"`.
- `transcript_id`: the session UUID (from the JSONL filename, minus `.jsonl`).
- `parent`: caller-supplied for child runs; `null` for the top-level main transcript.
- `agent.name`: `"claude-code"`; `agent.version`: the `version` field on the first line; `agent.model_default`: the `model` field on the first `assistant` line.
- `cwd`: the `cwd` field on the first line.
- `created_at` / `ended_at`: first and last line timestamps.
- `events`: the array built in pass 2, sorted by `ts` ascending; `parent_id` chained linearly within a Transcript.
- `subagents`: the array built in pass 3.
- `final_metrics`: roll-up totals across `events[*].usage` and all `subagents[*].final_metrics`.
- `provider.vendor`: `"claude-code"`; `provider.vendor_version`: same as `agent.version`; `provider.raw.unmapped_lines`: any line that didn't cleanly map.

## Sequencing checklist

- [ ] Resolve the main JSONL: either scan `~/.claude/projects/<project>/<session_id>.jsonl`, or take `--jsonl` directly.
- [ ] Pass 1: read the JSONL line by line; apply secret-redaction before any further work.
- [ ] Pass 2: map each line to one or more OT events. Preserve original `uuid` as `id`, `parentUuid` as `parent_id`, `timestamp` as `ts`.
- [ ] Pass 3: build the `tool_use.id → agentId` map. For each spawn, recursively transform the child JSONL and link via `parent` + `SubagentSpawn.spawned_transcript_id`.
- [ ] Pass 4: assemble the wrapper, compute `final_metrics`, attach `provider`.
- [ ] Validate against the invariants in the `open-transcripts-transcript` reference ("Invariants a Transcript must satisfy"): `events[]` sorted by `ts`; every `SubagentSpawn` has a matching entry in `subagents[]` (same level) and vice versa; no `undefined` (optional fields omitted or `null`).
- [ ] Write `transcript.json` and a `run.log` (source, redaction counts by pattern, unmapped-line counts by CC line type, line/subagent/event counts, wall-clock breakdown).
- [ ] Print the tmp dir path to stdout.

## Implementation notes

- **No LLM, no heuristics.** The transformation is deterministic. If the mapping is ambiguous, that's a gap in the `open-transcripts-claude-code-mapping` reference — flag it so the reference can be clarified at its source, rather than papering over it here.
- **Recursion shares one redaction pass.** Read each JSONL once; don't re-redact per pass.
- **The tmp folder is the single source of truth** for everything downstream. No analyze-* skill should reach back into `~/.claude/projects/` directly.
- **Streaming vs in-memory.** For session files under ~50 MB, build the whole event array in memory. Above that, stream the JSONL but still emit a single JSON document at the end.
- **Reuse prior art.** The JSONL parser and redaction regexes come from `pulsemcp/agentic-engineering-infra`'s `transcript-export.py`; don't reinvent them.

## Privacy

- Output is written to a local tmp folder, not uploaded anywhere.
- Redaction is applied during pass 1, before any field is written. Nothing downstream needs to know about redaction.
- `run.log` records what was redacted (counts, not values).
- Cleanup is the user's responsibility — emit a hint at the end (`rm -rf <path>`).

## Out of scope

- Picking which session to pull — that's `find-all-claude-code-transcripts`.
- Decomposing the Transcript into Segments — that's tier 2 (`decompose-into-transcript-segments`).
- Any analysis or scoring — that's the `analyze-*` skills.

## When the Claude Code format drifts

This skill is deterministic, so a CC JSONL field it doesn't recognize doesn't crash it — the field surfaces as a `SystemEvent` with `subtype = "unmapped"` and the raw line lands in `provider.raw.unmapped_lines[]`. That's the signal that the format has drifted.

When you see unmapped lines, **flag it** — don't quietly absorb it. Surface for the user that:

- The `open-transcripts-claude-code-mapping` reference is the source of truth for the CC → OT shape, and it appears to have drifted — it's the first thing that should be reconciled.
- This skill's transformation logic, and the `open-transcripts` example fixtures, would then follow the reference.
- If a CC field-shape change forces a breaking change to OpenTranscripts itself, that's a `schema_version` bump per the policy in the `open-transcripts` reference.

The fixes themselves belong at each artifact's source of truth, behind the normal PR gate — this skill's job at runtime is to **detect the drift and make the user aware of it**, precisely (which fields, which lines), not to patch anything in place.
