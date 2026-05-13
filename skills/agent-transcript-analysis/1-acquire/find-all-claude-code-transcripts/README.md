# `find-all-claude-code-transcripts`

Entry point of the analysis flow. Use this when you want to analyze a session but don't have its id yet — it lists everything under `~/.claude/projects/` and lets you pick one.

## How it plugs in

Upstream: none — this is the start of the chain.
Downstream: hands the chosen `session_id` to `get-one-claude-code-transcript`, which materializes the tmp folder the analyzers consume.

If the session id is already known, skip this and go straight to `get-one-claude-code-transcript`.

## Design decisions

- **Pick, don't archive.** The earlier `transcript-export` tool in `pulsemcp/agentic-engineering-infra` produced a redacted zip for sharing; this skill's only job is to surface a session id for the analysis pipeline.
- **Local browser UI, not CLI prompt.** Choosing between hundreds of sessions in a terminal is painful. A localhost page renders fast and supports filtering.
- **Redact server-side.** Secret patterns are scrubbed before any content reaches the browser, so even the local UI never sees raw values.
