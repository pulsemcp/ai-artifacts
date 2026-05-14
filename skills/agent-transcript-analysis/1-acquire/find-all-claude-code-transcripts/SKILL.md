---
name: find-all-claude-code-transcripts
description: >
  List all Claude Code session transcripts on this machine and let the user (or
  the agent) pick which one to analyze. Use this skill when the user wants to
  "find a session", "browse transcripts", "look at recent agent work", or as
  the first step of an analysis flow that doesn't yet have a target session id.
  Reads from `~/.claude/projects/` and spawns a local browser UI for selection.
user-invocable: true
---

# Find All Claude Code Transcripts

The entry point of the analysis workflow. Surfaces every session this machine has on disk and lets the caller pick one (or several) to feed into `get-one-claude-code-transcript`.

## When to use

- "Show me my recent sessions"
- "Find the session where I was working on X"
- The user wants to start an analysis but hasn't specified a session id
- You're chaining into `analyze-agent-transcript` and need to choose targets

If the user already has a session id in hand, **skip this skill** and go straight to `get-one-claude-code-transcript`.

## Invocation

```
python skills/agent-transcript-analysis/1-acquire/find-all-claude-code-transcripts/main.py \
    [--port 9849] [--no-browser]
```

`main.py` starts an HTTP server on `127.0.0.1:<port>` (default `9849`) and serves `ui.html`. The UI shows every session under `~/.claude/projects/`, sortable / filterable. Clicking "Analyze" POSTs to `/api/analyze`, which runs `get-one-claude-code-transcript` and surfaces the resulting `transcript.json` path.

Pass `--no-browser` to skip the auto-open (useful on remote / headless hosts where the user opens the URL manually).

## Sequencing checklist

- [ ] Verify `~/.claude/projects/` exists and has at least one project directory
- [ ] Start the local UI (default `localhost:9849`, fall back to next free port)
- [ ] Show one row per session: project, branch, last-active timestamp, user-prompt count, total tokens
- [ ] Apply server-side secret redaction before any content reaches the browser (see Privacy)
- [ ] On selection, return one or more session ids (and their on-disk paths) to the caller

## How it works

1. Walks `~/.claude/projects/<project-slug>/<session-id>.jsonl` and reads each session's first/last messages to build the index.
2. Serves a single static `ui.html` from a localhost HTTP server. No external requests, no CDN.
3. Renders sessions grouped by project, sortable by recency or token cost.
4. Returns the chosen session id(s) on the command line / via a small callback so the next skill in the chain can pick them up.

This is a thin re-skin of the prior `transcript-export` tool from `pulsemcp/agentic-engineering-infra` — the file walk, redaction, and UI serving are reused. The difference is the output: this skill's job is to **pick a session for analysis**, not to produce a redacted zip for sharing.

## Inputs

None required. Optional:

- `--since <duration>`: only show sessions active within the window (e.g. `7d`, `2h`).
- `--project <slug>`: scope to a single project.
- `--skip-ui`: print the index to stdout instead of opening a browser (useful for non-interactive flows).

## Outputs

- A list of `{session_id, project, jsonl_path, last_active}` objects. The agent should hand these to `get-one-claude-code-transcript` next.

## Privacy

- Redaction patterns (API keys, AWS creds, JWTs, GitHub tokens, connection strings, etc.) run server-side before content is rendered.
- The localhost server has no public binding and no upload endpoint.
- Original `.jsonl` files are never modified.
