---
name: get-one-claude-code-transcript
description: >
  Given a Claude Code session id, gather the main transcript and any subagent
  transcripts spawned from it into a single tmp folder, ready for analysis.
  Use this skill after find-all-claude-code-transcripts (or when the session
  id is already known) and before any of the analyze-* skills. The output is
  a path to a self-contained tmp directory with normalized JSONL plus a
  manifest describing the parent/subagent relationships.
user-invocable: true
---

# Get one Claude Code transcript

Pulls a single session — and every subagent transcript spawned from it — into one tmp folder so the rest of the analysis pipeline has a single, self-contained directory to work from.

## Inputs

- `session_id` (required): the Claude Code session UUID.
- `project_path` (optional): path used by Claude Code to namespace the session under `~/.claude/projects/`. Auto-detect from `session_id` if not provided.

## Output

A tmp directory (e.g. `/tmp/claude-transcript-<session_id>/`) containing:

```
manifest.json          # parent/subagent relationships, timestamps, model, etc.
main.jsonl             # the parent session transcript (redacted)
subagents/
  <subagent_id>.jsonl  # one file per subagent transcript (redacted)
  ...
```

`manifest.json` should at minimum carry: `session_id`, `project_path`, list of subagent ids and their parent message ids, generated-at timestamp, redaction summary (count by pattern).

The output path is written to stdout so downstream skills can consume it.

## Sequencing checklist

- [ ] Resolve the main JSONL file under `~/.claude/projects/<project>/<session_id>.jsonl`
- [ ] Parse it and find every `Agent` / `Task` tool call — these spawn subagents whose transcripts live in their own JSONL files (look for the subagent session id embedded in the tool result or in sibling JSONL files in the same project dir)
- [ ] Recurse: a subagent may itself spawn subagents
- [ ] Apply secret-redaction patterns to all content before writing the tmp folder
- [ ] Write `manifest.json`, `main.jsonl`, and `subagents/<id>.jsonl` files
- [ ] Print the tmp dir path to stdout

## Implementation notes

- The relationship between a parent message and a subagent transcript is the trickiest part. Inspect prior-art parsers in the archived [`pulsemcp/agentic-engineering-infra`](https://github.com/pulsemcp/agentic-engineering-infra) repo for the JSONL field names that tie them together.
- Reuse the redaction patterns from `transcript-export/transcript-export.py` in the same archived repo. Don't roll new regexes here.
- The tmp folder is the **single source of truth** for everything downstream. No analyze-* skill should reach back into `~/.claude/projects/` directly.

## Privacy

- Output is written to a local tmp folder, not uploaded anywhere.
- Redaction is applied before write. The manifest records what was redacted (counts, not values).
- Cleanup is the user's responsibility — emit a hint at the end (`rm -rf <path>`).

## Out of scope

- Picking which session to pull — that's `find-all-claude-code-transcripts`.
- Any analysis or scoring — that's `analyze-agent-transcript`.
