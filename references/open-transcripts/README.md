# OpenTranscripts

A vendor-neutral data model for coding-agent transcripts. Lives inline in this repo for now; may be proposed externally later. Everything below is **v0.1** — actively iterating, not stable.

## What's here

- [`schemas/transcript.md`](./schemas/transcript.md) — the `Transcript` wrapper: one self-contained JSON document per agent session.
- [`schemas/events.md`](./schemas/events.md) — the nine event types that go inside `Transcript.events[]`, plus supporting types.
- [`schemas/transcript-segment.md`](./schemas/transcript-segment.md) — the analysis layer that sits on top of a `Transcript`. The Trigger → Goal → Outcome tree consumed by every analyzer.
- [`mappings/claude-code.md`](./mappings/claude-code.md) — field-by-field mapping from Claude Code's `~/.claude/projects/**/<id>.jsonl` shape into a `Transcript`.
- [`examples/`](./examples/) — minimal `Transcript` instances; one with a subagent; a minimal Segment tree built on top of one.

## Two layers, intentionally separate

```
Raw vendor logs   →   Transcript        →   TranscriptSegment tree
(CC JSONL today)      (OpenTranscripts)     (analysis primitive)
```

- **Transcript** is the *carrier* — a normalized, vendor-neutral log of what happened. Nine event types, a wrapper with subagent links, redactable. Tier 1 of `agent-transcript-analysis` produces this.
- **TranscriptSegment** is the *interpretation* — a tree of Trigger → Goal → Outcome over those events. Tier 2 produces this. Tiers 3+ consume only Segments.

Keeping them separate means: a new vendor (Codex, Pi, Cursor, etc.) only needs a mapping doc to the Transcript layer; the Segment tree and every analyzer work unchanged.

## Non-goals

- **Not a streaming protocol.** OpenTranscripts is the *post-hoc* shape — what a finished session looks like on disk. It is not an event-bus / wire protocol for live agents (use OpenAI's, Anthropic's, or your runner's native streaming).
- **Not a tool-call schema.** Tool arguments and results stay opaque (`object`/`string`). We don't try to normalize what a `Read` or `Bash` call looks like across vendors.
- **Not a prompt-engineering format.** We don't capture system prompts, tools schemas, or sampling parameters as first-class — they go in `provider.raw` if present at all.
- **Not yet stable.** No backwards-compatibility guarantees. The schema_version is a marker, not a promise.

## Prior art considered

We surveyed Pi (`badlogic/pi-mono` / `earendil-works/pi`), OpenCode (`sst/opencode`), Codex CLI (`openai/codex`), Cursor's session export, Claude Code's own JSONL, and the OpenAI Chat Completions / Anthropic Messages APIs. ATIF (Agent Trajectory Interchange Format) was considered as a baseline; once we cross-checked every field against the agents that real teams ship, ATIF didn't earn a single unique citation — every field we wanted was already established by two or more of the coding-agent precedents above. So this spec cites the agents, not ATIF.

The convergence is real: Pi's `Session` + entry tree, Codex's `RolloutItem`, OpenCode's Parts, and Claude Code's content blocks all reach for similar shapes. Where ≥3 of them agree, we lift the shape and label it `[conv]`. Where the LLM provider APIs (OpenAI Chat Completions, Anthropic Messages) define the canonical wire shape, we lift directly and label it `[chat-completions]`. Where Claude Code is currently our only input vendor and the field has no clear cross-vendor convention yet, we lift and label `[cc]`. Where we add a small amount of glue not in any precedent, we label `[ours]` and justify it inline.

## Tagging legend

Every field decision in [`schemas/transcript.md`](./schemas/transcript.md) and [`schemas/events.md`](./schemas/events.md) carries a tag plus a direct quote from the source:

| Tag | Meaning | Bar |
|---|---|---|
| `[conv]` | Convention. Present in ≥3 of {Pi, OpenCode, Codex, Cursor, Claude Code}. | Field name may be normalized to the most common spelling; semantics must match. |
| `[chat-completions]` | OpenAI Chat Completions or Anthropic Messages API shape. | Lifted directly; field name preserved. |
| `[cc]` | Claude Code only — we have no other vendor's input yet. | Acceptable for v0.1; gets re-evaluated when a second vendor lands. |
| `[ours]` | Glue field not in any precedent. | Must be (a) generated deterministically from CC data and (b) needed by the analysis pipeline. |

If a field is `[ours]` it must include "Why it's ours and not lifted:" inline.

## Schema versioning

Every `Transcript` carries a `schema_version` (currently `"0.1"`). The policy:

- **Patch bumps** (`0.1` → `0.1.x` if we ever) — adding optional fields, clarifying docs. No reader changes required.
- **Minor bumps** (`0.1` → `0.2`) — adding new event types, renaming fields. Readers must handle both versions during the transition.
- **Major bumps** (`0.x` → `1.0`) — breaking re-shapes. We commit to writing migration docs.

Readers that hit an unknown `schema_version` should warn-and-attempt rather than refuse — most readers can survive added optional fields.

## Local-first, redact-on-the-way-in

Nothing in this plugin uploads transcripts. All transformation happens in a local tmp folder. The CC→OT transformation applies secret-redaction patterns **before** writing `transcript.json` so no downstream consumer ever sees raw secrets.
