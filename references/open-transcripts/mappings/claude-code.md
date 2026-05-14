# Claude Code → OpenTranscripts mapping

How Claude Code's `~/.claude/projects/<project-slug>/<session-uuid>.jsonl` files map onto OpenTranscripts v0.1. This is the canonical field-by-field reference used by the `get-claude-code-transcript` skill.

Maintenance contract: this doc is the canonical spec for the mapping. When CC adds, renames, or removes a JSONL field, `get-claude-code-transcript` keeps running — any line it can't place becomes a `SystemEvent` and is accumulated in `provider.raw.unmapped_lines[]` rather than dropped — and the drift is reconciled back into this doc. Updating here is what promotes a drifted line back to a first-class event.

## Source shape (what CC writes)

Claude Code session storage (CC ≥ ~2.1.x; older versions wrote subagents as sibling files — see "Legacy layouts" below):

```
~/.claude/projects/<cwd-with-slashes-replaced-by-dashes>/
  <session-uuid>.jsonl                      ← main session transcript
  <session-uuid>/                           ← session-scoped sidecar dir
    subagents/
      agent-<agentId>.jsonl                 ← one file per subagent spawn
      agent-<agentId>.meta.json             ← { "agentType", "description" }
    tool-results/
      <tool_use_id>.txt                     ← long tool_result bodies spilled to disk
```

The main file's name is the session UUID (this becomes `Transcript.transcript_id`). Subagent files live one directory deeper — under `<session-uuid>/subagents/` — and are named `agent-<agentId>.jsonl`, where `<agentId>` is what the parent's `tool_result.toolUseResult.agentId` references. The companion `.meta.json` carries the subagent's `agentType` and the spawning `description`; this is the only place the agentType is preserved if the parent transcript is truncated.

The `tool-results/` directory contains text files for tool_result bodies that exceeded CC's inline limit. The parent JSONL line still carries the tool_result block, but its `content` may reference `<tool_use_id>.txt` instead of inlining the full body.

### Legacy layouts

- **CC ≤ ~2.0.x:** subagent JSONLs were written as siblings of the parent file (`~/.claude/projects/<project>/<agentId>.jsonl`) with no `<session-uuid>/` sidecar dir. The transformer should fall back to sibling lookup if `<session-uuid>/subagents/agent-<agentId>.jsonl` doesn't exist.
- **Orphan sessions:** some projects contain only the sidecar dir (no parent `.jsonl`). These are unrecoverable; tier 1 skips them with a warning.

Each JSONL line is a JSON object with at minimum a `type` field. Empirical line types observed in production CC transcripts:

- **Conversation lines:** `user`, `assistant`, `system`
- **Tool content blocks (nested inside user/assistant lines):** `text`, `tool_use`, `tool_result`, `thinking`
- **CC-internal lines:** `attachment`, `ai-title`, `last-prompt`, `queue-operation`, `permission-mode`, `pr-link`, `file-history-snapshot`

Common fields on every line: `uuid`, `parentUuid`, `timestamp`, `sessionId`, `cwd`, `version`, optionally `agentId` (set on subagent lines).

## Transcript wrapper mapping

| OpenTranscripts field | Source in CC JSONL |
|---|---|
| `schema_version` | Hard-coded `"0.1"` by the transformer. |
| `transcript_id` | The session UUID from the JSONL filename. |
| `parent` | `null` for the main transcript. For a subagent: `{ transcript_id: <parent session uuid>, spawn_event_id: <id of the SubagentSpawn event in the parent> }`. Computed by tier 1, not present in CC. |
| `agent.name` | Hard-coded `"claude-code"`. |
| `agent.version` | From the `version` field on the first line. |
| `agent.model_default` | The `model` field on the first `assistant` line; later overrides go on per-event `AssistantMessage.model`. |
| `cwd` | The `cwd` field on the first line. |
| `created_at` | The `timestamp` field on the first line. |
| `ended_at` | The `timestamp` field on the last line. |
| `events` | One entry per CC JSONL line, mapped per the table below. |
| `subagents` | One full `Transcript` per linked subagent file. Linkage via the 4-field chain (see "Subagent linkage" below). |
| `final_metrics.total_tokens_in` | Sum of `assistant[*].message.usage.input_tokens` across this transcript and all descendants. |
| `final_metrics.total_tokens_out` | Sum of `assistant[*].message.usage.output_tokens` across this transcript and all descendants. |
| `final_metrics.cost_usd` | Computed from token totals + the model's published price card; `null` if pricing unknown. |
| `final_metrics.wall_clock_s` | `ended_at - created_at` in seconds. |
| `provider.vendor` | Hard-coded `"claude-code"`. |
| `provider.vendor_version` | From the `version` field (same as `agent.version`). |
| `provider.raw.unmapped_lines` | Any CC line type the transformer didn't map to a first-class event ends up here, post-redaction. |

## Per-line → Event mapping

Each CC JSONL line becomes exactly one OT `Event`. The event's `id` is the line's `uuid`; `parent_id` is the line's `parentUuid`; `ts` is the line's `timestamp`; `provider_raw` is the original line (post-redaction) minus the fields hoisted to top-level.

| CC line shape | OT event `type` | Notes |
|---|---|---|
| `{"type":"user","message":{"content":[{"type":"text",...}]}}` | `UserMessage` | `content` mapped per the ContentPart table below. Attachments go in `attachments[]`. |
| `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"...","content":...,"is_error":...}],"toolUseResult":{...}}}` | `ToolResult` | A CC "user" line carrying a tool_result block is the tool's reply to the assistant. The `toolUseResult.agentId` field, when present, is what links a `SubagentSpawn` to its child transcript — but the OT event for this line is still a `ToolResult`. The `SubagentSpawn` event is emitted alongside the matching `tool_use` block (next row). |
| `{"type":"assistant","message":{"content":[{"type":"text","text":"..."},...],"model":"...","usage":{...},"stop_reason":"..."}}` | `AssistantMessage` (+ optional `Thinking`, `ToolCall`, `SubagentSpawn` siblings) | One CC `assistant` line can contain multiple content blocks. We emit one `AssistantMessage` for the text-only blocks, plus one additional event per `thinking` / `tool_use` block. All share the same `parent_id` (the prior event) and ascending `id`s within the same `ts`. |
| `{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"...","signature":"..."}]}}` | `Thinking` | `text` ← `thinking`, `signature` ← `signature`, `redacted` ← `false` (or `true` if the block was `redacted_thinking`). |
| `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_...","name":"Read","input":{...}}]}}` | `ToolCall` | `tool_call_id` ← `id`, `tool_name` ← `name`, `arguments` ← `input`. |
| `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_...","name":"Agent","input":{"subagent_type":"...","description":"...","prompt":"..."}}]}}` | `SubagentSpawn` (in addition to a `ToolCall`) | Whenever `tool_use.name` is `"Agent"` (CC ≥ 2.1.x) **or** `"Task"` (legacy), emit *both* a `ToolCall` event (preserving the raw tool_use for symmetry) *and* a `SubagentSpawn` event. The `SubagentSpawn` carries `tool_call_id` ← `id`, `subagent_type` ← `input.subagent_type`, `description` ← `input.description`, `prompt` ← `input.prompt`. The `spawned_transcript_id` is resolved by looking ahead for the matching `tool_result` whose `toolUseResult.agentId` names the child file. |
| `{"type":"system",...}` with a recognizable error payload | `Error` | Set `message` from the system text, `code` from any structured error code, `recoverable` from whether the next event is a retry. |
| `{"type":"attachment",...}` | Inlined into the preceding `UserMessage.attachments[]` if temporally adjacent; otherwise `SystemEvent` with `subtype = "attachment"`. |
| `{"type":"ai-title", ...}` | `SystemEvent` with `subtype = "ai-title"`. |
| `{"type":"last-prompt", ...}` | `SystemEvent` with `subtype = "last-prompt"`. |
| `{"type":"queue-operation", ...}` | `SystemEvent` with `subtype = "queue-operation"`. |
| `{"type":"permission-mode", ...}` | `SystemEvent` with `subtype = "permission-mode"`. |
| `{"type":"pr-link", ...}` | `SystemEvent` with `subtype = "pr-link"`. |
| `{"type":"file-history-snapshot", ...}` | `SystemEvent` with `subtype = "file-history-snapshot"`. |
| `{"isCompactSummary": true, ...}` (CC emits compactions inline) | `Compaction` | `summary` from the compaction text. `first_kept_event_id` ← `uuid` of the first event after the compaction marker. `tokens_before` / `tokens_after` from CC's running token estimate if present; otherwise `null`. `trigger` ← `"auto"` if CC emitted it without user input, `"manual"` if preceded by a `/compact` user message. |
| any other unrecognized line | `SystemEvent` with `subtype = "<the line's type>"` + payload preserved. Also accumulated in `provider.raw.unmapped_lines[]`. |

## ContentPart mapping

CC blocks inside a `user.message.content` or `assistant.message.content` array:

| CC block | OT `ContentPart` |
|---|---|
| `{"type":"text","text":"..."}` | `{ "type": "text", "text": "..." }` |
| `{"type":"image","source":{"data":"...","media_type":"image/png"}}` | `{ "type": "image", "data": "...", "mime_type": "image/png" }` |
| `{"type":"tool_use",...}` | Not a ContentPart — promoted to its own `ToolCall` event. |
| `{"type":"tool_result",...}` | Not a ContentPart — promoted to its own `ToolResult` event. |
| `{"type":"thinking",...}` | Not a ContentPart — promoted to its own `Thinking` event. |

## Usage mapping

CC's per-line `usage` field shape (from `assistant.message.usage`):

```json
{ "input_tokens": ..., "output_tokens": ..., "cache_read_input_tokens": ..., "cache_creation_input_tokens": ... }
```

→ OT `AssistantMessage.usage`:

```json
{ "input_tokens": ..., "output_tokens": ..., "cache_read_tokens": ..., "cache_write_tokens": ... }
```

Direct rename: `cache_read_input_tokens` → `cache_read_tokens`, `cache_creation_input_tokens` → `cache_write_tokens`. Semantics unchanged.

## Stop reason mapping

CC's `stop_reason` values pass through unchanged (`end_turn`, `stop_sequence`, `max_tokens`, `tool_use`). If CC emits an unknown value, store it as-is — readers are expected to tolerate forward additions.

## Subagent linkage (the 4-field chain)

Subagent linkage is fully recoverable from CC's JSONL with no heuristics. The canonical chain:

1. **Parent emits the spawn**: an `assistant` line contains a `tool_use` block with `name: "Task"` and an `id`, e.g. `"id": "toolu_01ABC..."`.
2. **Parent receives the result**: a `user` line contains a `tool_result` block whose `tool_use_id` equals `toolu_01ABC...`. The same line carries `toolUseResult.agentId: "<hex>"` (e.g. `"a22e0309e671971d8"` — note: no `agent_` prefix on the bare id, the prefix is only on the filename).
3. **Subagent file name**: `<session-uuid>/subagents/agent-<agentId>.jsonl` next to the parent transcript. Companion `agent-<agentId>.meta.json` carries `{ "agentType", "description" }`.
4. **Every line of the subagent file** carries `"agentId": "<agentId>"` and `"isSidechain": true`.

Tier 1 walks the parent linearly, building a map `toolu_xxx → agentId` as it sees each Task spawn + tool_result pair. For each entry, it loads `<session-uuid>/subagents/agent-<agentId>.jsonl` (falling back to the legacy sibling layout if not found) and emits a child `Transcript`. The child's `parent.spawn_event_id` is the id of the OT `SubagentSpawn` event emitted from step 1.

Subagents can themselves spawn subagents; the recursion uses the same chain unchanged.

## Redaction

Apply the redaction patterns from `pulsemcp/agentic-engineering-infra`'s `transcript-export/transcript-export.py` (the patterns we shipped there for `API_KEY`, `STRIPE_KEY`, `AWS_*`, `BEARER_TOKEN`, `PRIVATE_KEY`, etc.) to all string fields *before* any line is written to OT. The OT `Transcript` should never contain raw secrets.

Tier 1 includes `redaction_summary` info in its own run log (counts by pattern) but does **not** carry that into `Transcript` — readers don't need it.

## What we do not preserve

- **CC's `uuid` vs OT's `id`.** OT keeps the same id (we don't generate new ones), so `uuid` is not preserved separately.
- **CC's `sessionId` field per line.** Redundant with `transcript_id`; dropped.
- **CC's `parentUuid`.** Same value as OT's `parent_id`; dropped from `provider_raw`.
- **Streaming partials.** CC sometimes writes partial-then-complete blocks during a single line's flush; we keep only the complete form.

Everything else CC writes is preserved either as a first-class OT field or under `provider_raw` on the event.
