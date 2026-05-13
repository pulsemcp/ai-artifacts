# `decompose-into-transcript-segments`

The skill that produces the Transcript Segment tree. Sole gatekeeper of the data model in `references/transcript-segment.md`.

## How it plugs in

Upstream: `1-acquire/get-one-claude-code-transcript/` produces the tmp folder this consumes.
Downstream: every tier-3 and tier-4 skill reads `segments.json` from the tmp folder. The flamegraph is for humans only.

## Design decisions

- **Read JSONL once.** This is the only skill that walks raw turns. Cost lives here so analyzers can stay cheap.
- **Goal labels in one sentence.** Anything longer means the segment should probably be split into sub-segments.
- **A Correction at the next segment's head retroactively marks the prior segment as Failure.** This is the most reliable failure signal — agents often look confident even when wrong.
- **Plan vs Action is determined by state-mutation.** Read-only work is Plan; writes (Edit, Write, side-effectful Bash, mutating MCP calls) are Action. Avoids subjective calls.
- **Flamegraph is HTML, not SVG.** Inline annotations + click-to-expand work better in HTML and we already serve a localhost UI elsewhere in the plugin.
