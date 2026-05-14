# `decompose-agent-transcript-into-transcript-segments`

The skill that produces the Transcript Segment tree. Sole gatekeeper of the data model in the `transcript-segment` reference.

## How it plugs in

Upstream: `get-claude-code-transcript-from-local` produces `transcript.json` (an OpenTranscripts Transcript document) — this skill consumes it.

Downstream: every tier-3 and tier-4 skill reads `segments.json` from the tmp folder, and dereferences event ids back into `transcript.json` for evidence. The flamegraph is for humans only.

## Design decisions

- **Walk the Transcript once.** This is the only skill that walks every event. Cost lives here so analyzers can stay cheap.
- **Read OpenTranscripts, not CC JSONL.** Tier 1 already normalized; this skill is vendor-agnostic by construction.
- **Goal labels in one sentence.** Anything longer means the segment should probably be split into sub-segments.
- **A Correction at the next segment's head retroactively marks the prior segment as Failure.** This is the most reliable failure signal — agents often look confident even when wrong.
- **Plan vs Action is determined by state-mutation.** Read-only `ToolCall`s are Plan; writes (Edit, Write, side-effectful Bash, mutating MCP calls) are Action. Avoids subjective calls.
- **Flamegraph is HTML, not SVG.** Inline annotations + click-to-expand work better in HTML and we already serve a localhost UI elsewhere in the plugin.
