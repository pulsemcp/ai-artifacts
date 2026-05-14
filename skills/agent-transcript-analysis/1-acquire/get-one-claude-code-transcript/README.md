# `get-one-claude-code-transcript`

Given a session id, produces a single OpenTranscripts `transcript.json` containing the main session plus every subagent it spawned. The output is self-contained — every downstream skill reads from this one file.

## How it plugs in

Upstream: usually `find-all-claude-code-transcripts`, sometimes a session id the user already has.

Downstream: tier 2 (`decompose-into-transcript-segments`) reads `transcript.json` and builds the Segment tree. All tier-4 analyzers read the Segment tree plus dereference event ids back into the same `transcript.json` for evidence.

This skill is a thin orchestrator. The CC→OT deterministic transformation lives in `claude-code-to-open-transcript`.

## Design decisions

- **One self-contained JSON document.** Subagents are embedded under `subagents[]` rather than left as sibling files; downstream consumers don't have to re-link anything.
- **Transformation is a separate skill.** `claude-code-to-open-transcript/` owns the CC→OT mapping so the contract can be tested in isolation and reused by other entry points.
- **Redact on the way in.** Secret patterns are applied during transformation, before `transcript.json` is written. Nothing downstream needs to know about redaction.
- **OpenTranscripts as the contract.** The output shape is governed by the `open-transcripts` reference set, not by Claude Code's JSONL format. When CC changes, only the mapping doc + transformation skill change; the wire format readers see is stable.
