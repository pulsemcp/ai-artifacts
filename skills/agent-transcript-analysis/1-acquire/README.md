# Tier 1: `1-acquire`

Data-acquisition layer of the analysis pipeline. Skills here turn "I want to analyze a session" into a self-contained tmp folder the rest of the pipeline can consume.

## Skills in this tier

- `find-all-claude-code-transcripts/` — picks which session to analyze
- `get-one-claude-code-transcript/` — gathers the main + subagent transcripts into one tmp folder

## How this tier plugs into the rest

Tier 1 → Tier 2 (`2-orchestrate/analyze-agent-transcript`). The orchestrator never reads from `~/.claude/projects/` directly; it consumes the tmp folder this tier produces. That contract is what lets the rest of the pipeline stay simple.

## Design decisions

- **Acquisition is its own tier, separate from analysis.** Keeps the analyzers from knowing anything about on-disk Claude Code state — they only ever see a `manifest.json` + `main.jsonl` + `subagents/`.
- **One tmp folder per session.** Every downstream skill reads from the same directory; no skill should look elsewhere for transcript data.
- **Redact on the way in.** Secret patterns are applied before files are written, so no analyzer needs to redact.
