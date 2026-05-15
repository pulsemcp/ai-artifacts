# Phase 1: `1-acquire`

Data-acquisition layer of the analysis pipeline. Skills here turn "I want to analyze a session" into a single OpenTranscripts `transcript.json` — plus the `external-context.json` that explains *why* the session happened — that the rest of the pipeline can consume.

## Skills in this phase

- `find-all-claude-code-transcripts-on-local/` — picks which session to analyze.
- `get-claude-code-transcript-from-local/` — turns a chosen session id into one `transcript.json`. Owns the deterministic CC → OpenTranscripts transformation.
- `gather-agent-transcript-external-context/` — pulls the surrounding *why* — the ticket, the PR, light user context — into one `external-context.json` that travels with the transcript. Best-effort: missing sources are recorded, never fatal.
- `review-agent-transcript-external-context/` — **optional human review checkpoint.** Opens a localhost UI to audit and correct the AI-gathered context; writes `external-context.reviewed.json` next to the draft with full correction provenance. The draft is never overwritten.

## How this phase plugs into the rest

Phase 1 → Phase 2 (`2-decompose/decompose-agent-transcript-into-transcript-segments`). Phase 2 is the only skill that walks `transcript.json` to build the Segment tree; phase 3+ consume the Segment tree (and dereference event ids back into `transcript.json` for evidence). Phase 1 → `transcript.json` → Phase 2 → `segments.json` → everything else.

`external-context.json` rides alongside `transcript.json` in the same `tmp_dir` and is available — unchanged — to phase 2 and every phase-3 analyzer, so judgments about a Segment's Goal and Outcome can lean on the ticket and PR behind the work rather than guessing. It is best-effort: the pipeline runs fine when it is absent.

## Design decisions

- **Acquisition is its own phase, separate from analysis.** Analyzers only ever see an OpenTranscripts `Transcript`; they never know anything about on-disk Claude Code state.
- **OpenTranscripts is the contract.** The output shape is defined by the `open-transcripts` reference set, not by Claude Code's JSONL. When CC changes, only the mapping doc + the transformation skill change.
- **One self-contained JSON per session.** Subagents are embedded recursively under `subagents[]`. No sibling files to re-link downstream.
- **Acquire and transform are one skill.** `get-claude-code-transcript-from-local/` resolves the session id *and* runs the deterministic CC→OT transformation. The mapping stays governed by the `open-transcripts-claude-code-mapping` reference, which is the real reusable contract — a separate transformation skill added a hop without adding leverage.
- **Context is acquired here too, not derived later.** `transcript.json` is *what* the agent did; `external-context.json` is *why*. Gathering the ticket / PR / user context once, up front, beats every downstream analyzer re-deriving it per Segment — and it gets its own corrections checkpoint (`review-agent-transcript-external-context`) before phase 2, because a confident-but-wrong ticket would poison everything after it.
- **Redact on the way in.** Secret patterns are applied during transformation — and during context-gathering, before any ticket or PR body touches disk — so no analyzer needs to redact.
