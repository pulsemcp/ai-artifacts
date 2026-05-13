# `get-one-claude-code-transcript`

Given a session id, gathers the main transcript **plus every subagent transcript spawned from it** into a single self-contained tmp folder. Use this immediately before any `analyze-*` skill.

## How it plugs in

Upstream: usually `find-all-claude-code-transcripts`, sometimes a session id the user already has.
Downstream: every `analyze-*` skill reads from the tmp folder this produces. The folder is the single source of truth — no analyzer should reach back into `~/.claude/projects/` directly.

## Design decisions

- **Subagents are first-class.** A meaningful chunk of recent agent work happens in subagent transcripts; pulling only the parent JSONL would miss it.
- **One tmp folder per run.** All downstream skills consume `manifest.json` + `main.jsonl` + `subagents/*.jsonl` from the same directory. Keeps the contract simple.
- **Redact on the way in.** Secret patterns are applied before files are written, so nothing downstream needs to know about redaction.
- **Reuse prior-art parsers.** Subagent linkage and redaction patterns come from `pulsemcp/agentic-engineering-infra`; we don't reinvent them.
