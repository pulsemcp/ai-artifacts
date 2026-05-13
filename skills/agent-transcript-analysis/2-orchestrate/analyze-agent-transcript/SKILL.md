---
name: analyze-agent-transcript
description: >
  Orchestrator for analyzing a single Claude Code session transcript. Takes
  the tmp folder produced by get-one-claude-code-transcript, splits the
  transcript into goal-aligned segments, runs the per-segment analyzers
  (analyze-user-prompt, analyze-skill-*, analyze-mcp-*), and aggregates
  their findings into actionable recommendations across three buckets:
  human prompting, Skills (create/modify/delete), and MCP servers
  (create/modify/delete). Use this skill when the user wants a full analysis
  of a session, a "how could this have gone better" review, or to surface
  Skill/MCP opportunities from real usage.
user-invocable: true
---

# Analyze agent transcript

The orchestrator. Turns a transcript into an actionable list of changes — to the user's prompting habits, to the Skill portfolio, and to the MCP server portfolio.

## Inputs

- `tmp_dir` (required): output of `get-one-claude-code-transcript`. Must contain `manifest.json`, `main.jsonl`, and an optional `subagents/` directory.
- `philosophy_skills` (optional): path to `references/philosophy-on-skills.md`. Defaults to the bundled copy.
- `philosophy_mcp` (optional): path to `references/philosophy-on-mcp.md`. Defaults to the bundled copy.

## Output

A structured report (Markdown + JSON sidecar) with this shape:

```
# Session <id> analysis

## Segments
1. <segment title> — turns N..M, goal: <…>
2. ...

## Per-segment findings
### Segment 1: <title>
  - User prompt: <summary from analyze-user-prompt>
  - Skill performance: <summary from analyze-skill-*>
  - MCP performance:   <summary from analyze-mcp-*>
  - Recommendations:
    - Prompting: <…>
    - Skills:    create / modify / delete <…>
    - MCP:       create / modify / delete <…>

## Aggregated recommendations
  - Prompting: <consolidated list>
  - Skills:    <consolidated list, deduped>
  - MCP:       <consolidated list, deduped>
```

Every recommendation must be specific enough to act on — to open a PR, to rewrite a prompt, or to file an issue.

## Sequencing checklist

- [ ] Load `manifest.json` and the JSONL files from `tmp_dir`
- [ ] **Segment** the transcript: each segment corresponds to a coherent user goal. A new user prompt that introduces a new goal starts a new segment; follow-up prompts that continue the same goal stay in the current segment
- [ ] For each segment, in order:
  - [ ] Run `analyze-user-prompt`
  - [ ] Run `analyze-skill-trigger-performance`
  - [ ] Run `analyze-skill-action-performance`
  - [ ] Run `analyze-skill-gaps`
  - [ ] Run `analyze-mcp-trigger-performance`
  - [ ] Run `analyze-mcp-action-performance`
  - [ ] Run `analyze-mcp-gaps`
- [ ] Aggregate per-segment recommendations across the whole session, deduping similar suggestions
- [ ] Cross-reference recommendations against the philosophy docs and drop any that contradict them, or note the contradiction so the human reviewer can resolve it
- [ ] Emit the report

## Signals to look for during segmentation

These are the team's "when to create or modify a Skill" heuristics — the analyzers should be biased toward finding them:

1. **Mistake despite a correct prompt** — segment ended in the wrong outcome but the prompt was clear and unambiguous
2. **Repeated long prompt** — the user wrote a long context-establishing prompt that they (or a teammate, in another transcript) have written before
3. **Repeated work segment** — the agent spent meaningful time figuring out something it already figured out in a previous session
4. **Wheel-spinning** — wall-clock and token cost vastly exceed what a human would have spent
5. **Foreseeable closed-loop limitation** — the user couldn't write a one-shot prompt because critical context lives outside the agent's reach (suggests a missing MCP server, often wrapped by a Skill)

## Out of scope

- Acquiring the transcript — that's `get-one-claude-code-transcript`.
- The actual per-segment scoring — that's the `analyze-*` skills below this orchestrator.
