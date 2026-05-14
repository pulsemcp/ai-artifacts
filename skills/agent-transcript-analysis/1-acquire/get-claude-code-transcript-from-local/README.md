# `get-claude-code-transcript-from-local`

Given a session id (or a JSONL path), produces a single OpenTranscripts `transcript.json` containing the main session plus every subagent it spawned. The output is self-contained — every downstream skill reads from this one file.

## How it plugs in

Upstream: usually `find-all-claude-code-transcripts-on-local`, sometimes a session id the user already has.

Downstream: tier 2 (`decompose-agent-transcript-into-transcript-segments`) reads `transcript.json` and builds the Segment tree. All tier-4 analyzers read the Segment tree plus dereference event ids back into the same `transcript.json` for evidence.

This skill owns the deterministic CC→OpenTranscripts transformation. The canonical mapping is documented in the `open-transcripts-claude-code-mapping` reference — the source of truth for the CC → OT shape. When CC's format changes, the drift surfaces as unmapped lines in this skill's output; that's the cue to flag the mapping reference for reconciliation at its source.

## Design decisions

- **One skill, one job: a session id in, a transcript out.** Locating the session and transforming it were previously two skills (`get-one-claude-code-transcript` orchestrating `claude-code-to-open-transcript`). In practice you always acquire from the local filesystem and the transform is already governed by a reference doc — so the two-skill hop was friction without payoff. The deterministic transform is now a clearly-delineated set of passes *inside* this skill, and the `open-transcripts-claude-code-mapping` reference remains the vendor contract.
- **One self-contained JSON document.** Subagents are embedded under `subagents[]` rather than left as sibling files; downstream consumers don't have to re-link anything.
- **Redact on the way in.** Secret patterns are applied during pass 1, before `transcript.json` is written. Nothing downstream needs to know about redaction.
- **OpenTranscripts as the contract.** The output shape is governed by the `open-transcripts` reference set, not by Claude Code's JSONL format. When CC changes, only the mapping doc + this skill's transformation logic change; the wire format readers see is stable.
- **Subagent linkage uses the canonical chain.** The four CC fields (`tool_use.id`, `tool_result.tool_use_id`, `toolUseResult.agentId`, subagent filename `agentId`) form a deterministic chain. We do not guess from timestamps or proximity.
