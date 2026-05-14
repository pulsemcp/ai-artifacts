---
name: get-one-claude-code-transcript
description: >
  Given a Claude Code session id, produce a single OpenTranscripts
  `transcript.json` — the main session plus every subagent it spawned, linked
  and nested in one self-contained JSON document. Use this skill after
  find-all-claude-code-transcripts (or when the session id is already known)
  and before any of the analyze-* skills. The output is a path to a tmp
  directory containing transcript.json conforming to the
  open-transcripts-transcript reference.
user-invocable: true
---

# Get one Claude Code transcript

Orchestrates the acquisition step of the analysis pipeline: takes a CC session id, gathers the main JSONL plus every linked subagent JSONL, runs the deterministic CC→OpenTranscripts transformation, and emits a single `transcript.json` ready for tier 2.

## Invocation

```
python main.py <session-uuid> [--tmp-root <dir>] [--pretty]
```

`main.py` is the reference implementation. It scans `~/.claude/projects/*/<session-uuid>.jsonl`, calls `claude-code-to-open-transcript` under the hood, and prints the output directory path on stdout. The output dir defaults to `$TMPDIR/transcript-analysis/<session-uuid>/`.

## Inputs

- `session_id` (required): the Claude Code session UUID.
- `--tmp-root` (optional): override the tmp output root. Defaults to `$TMPDIR/transcript-analysis/`.

## Output

A tmp directory (e.g. `/tmp/claude-transcript-<session_id>/`) containing:

```
transcript.json    # the OpenTranscripts Transcript document (redacted)
run.log            # acquisition run log: redaction counts, unmapped line counts, timings
```

`transcript.json` conforms to the `open-transcripts-transcript` reference (the wrapper) and the `open-transcripts-events` reference (events). Subagents are embedded recursively under `subagents[]`; nothing is left on disk that the consumer needs to re-link.

The output path is written to stdout so downstream skills can consume it.

## Sequencing checklist

This skill is a thin orchestrator. The actual work happens in sub-skills:

- [ ] Resolve the main JSONL file under `~/.claude/projects/<project>/<session_id>.jsonl`
- [ ] Call `claude-code-to-open-transcript` with the main JSONL path — this skill handles JSONL parsing, the 4-field subagent linkage chain, recursive subagent loading, secret-redaction, and CC→OT field mapping per the `open-transcripts-claude-code-mapping` reference
- [ ] Write the resulting `Transcript` JSON to `<tmp_dir>/transcript.json`
- [ ] Write a `run.log` with redaction counts (by pattern), unmapped-line counts (by CC line type), and the wall-clock breakdown
- [ ] Print the tmp dir path to stdout

## Implementation notes

- Don't re-implement the CC→OT transformation here; delegate to `claude-code-to-open-transcript`. That skill owns the canonical mapping.
- The tmp folder is the **single source of truth** for everything downstream. No analyze-* skill should reach back into `~/.claude/projects/` directly.
- Redaction is part of the transformation skill — by the time `transcript.json` lands on disk, secrets are already gone.

## Privacy

- Output is written to a local tmp folder, not uploaded anywhere.
- Redaction is applied during the transformation (inside `claude-code-to-open-transcript`), before any field is written.
- `run.log` records what was redacted (counts, not values).
- Cleanup is the user's responsibility — emit a hint at the end (`rm -rf <path>`).

## Out of scope

- Picking which session to pull — that's `find-all-claude-code-transcripts`.
- The deterministic CC→OT mapping — that's `claude-code-to-open-transcript`.
- Any analysis or scoring — that's the `analyze-*` skills.
