# Tier 1: `1-acquire`

Data-acquisition layer of the analysis pipeline. Skills here turn "I want to analyze a session" into a single OpenTranscripts `transcript.json` the rest of the pipeline can consume.

## Skills in this tier

- `find-all-claude-code-transcripts/` — picks which session to analyze.
- `get-one-claude-code-transcript/` — orchestrates acquisition for a chosen session. Thin wrapper around the transformation skill.
- `claude-code-to-open-transcript/` — the deterministic CC → OpenTranscripts transformation. Owns the canonical mapping.

## How this tier plugs into the rest

Tier 1 → Tier 2 (`2-decompose/decompose-into-transcript-segments`). Tier 2 is the only skill that walks `transcript.json` to build the Segment tree; tier 3+ consume the Segment tree (and dereference event ids back into `transcript.json` for evidence). Tier 1 → `transcript.json` → Tier 2 → `segments.json` → everything else.

## Design decisions

- **Acquisition is its own tier, separate from analysis.** Analyzers only ever see an OpenTranscripts `Transcript`; they never know anything about on-disk Claude Code state.
- **OpenTranscripts is the contract.** The output shape is defined in [`references/open-transcripts/`](../../../references/open-transcripts/), not by Claude Code's JSONL. When CC changes, only the mapping doc + the transformation skill change.
- **One self-contained JSON per session.** Subagents are embedded recursively under `subagents[]`. No sibling files to re-link downstream.
- **Mapping has its own skill.** `claude-code-to-open-transcript/` is the deterministic CC→OT script. `get-one-claude-code-transcript/` is a thin orchestrator. This split keeps the mapping testable and lets new entry points reuse it.
- **Redact on the way in.** Secret patterns are applied during transformation, so no analyzer needs to redact.
