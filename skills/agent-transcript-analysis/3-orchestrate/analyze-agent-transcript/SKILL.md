---
name: analyze-agent-transcript
description: >
  Orchestrator for analyzing a single Claude Code session transcript. Takes
  the tmp folder produced by get-claude-code-transcript, invokes
  decompose-into-transcript-segments to produce the Segment tree, then drives
  the per-Segment analyzers across four buckets (outcomes, prompts, skills,
  mcp) and aggregates their findings into actionable recommendations across
  three output buckets: human prompting, Skills (create/modify/delete), and
  MCP servers (create/modify/delete). Use this skill when the user wants a
  full single-session analysis, a "how could this have gone better" review,
  or to surface Skill/MCP opportunities from real usage.
user-invocable: true
---

# Analyze agent transcript

The orchestrator. Turns a transcript into an actionable list of changes — to the user's prompting habits, to the Skill portfolio, and to the MCP server portfolio.

The Transcript Segment is the analysis primitive. See the `transcript-segment` reference for the data model. This skill does not walk raw JSONL — it asks `decompose-into-transcript-segments` for `segments.json` and reads only from there.

## Inputs

- `tmp_dir` (required): output of `get-claude-code-transcript`. Must contain `transcript.json` (an OpenTranscripts `Transcript` document, subagents embedded recursively).
- `external_context` (optional): `external-context.json` — or `external-context.reviewed.json` — in the same `tmp_dir`, produced by `gather-external-context`. The ticket, PR, and user context behind the session. When present, pass it through to tier 2 and the tier-4 analyzers so Goal/Outcome judgments are grounded in *why* the session happened. Best-effort: absent is fine, never fatal.
- `philosophy_skills` (optional): the `philosophy-on-skills` reference. Defaults to the bundled copy.
- `philosophy_mcp` (optional): the `philosophy-on-mcp` reference. Defaults to the bundled copy.
- `transcript_segment_spec` (optional): the `transcript-segment` reference. Defaults to the bundled copy.

## Output

A structured report (Markdown + JSON sidecar) with this shape:

```
# Session <id> analysis

## Segment tree
  Pointer to segments.json and the rendered flamegraph. Top-level Goal,
  Outcome, and per-child Outcome counts for the root Segment.

## Per-segment findings
### Segment <id>: <Goal>  (Outcome: Success|Failure, Trigger: <kind>/<source>)
  - Failure hypothesis:   <from analyze-failure-hypothesis, if applicable>
  - Efficiency:           <from analyze-segment-efficiency>
  - Prompt analysis:      <from analyze-user-prompt + analyze-prompt-ambition>
  - Skill performance:    <from analyze-skill-trigger/action/gaps>
  - MCP performance:      <from analyze-mcp-trigger/action/gaps>
  - Recommendations:
    - Prompting: <…>
    - Skills:    create / modify / delete <…>
    - MCP:       create / modify / delete <…>

## Aggregated recommendations
  - Prompting: <consolidated list, deduped>
  - Skills:    <consolidated list, deduped>
  - MCP:       <consolidated list, deduped>

## Distance from ideal end-state
  Single paragraph: how many Failure Outcomes, how many Correction triggers
  (broken out by user-source vs agent-source), total wall-clock vs sum of
  human counterfactuals, count of user-source New triggers flagged as
  deterministic-trigger candidates. The north-star measured.
```

Every recommendation must be specific enough to act on — to open a PR, to rewrite a prompt, or to file an issue.

## Sequencing checklist

- [ ] **Pick up external context if it exists.** Check `tmp_dir` for `external-context.json` (prefer `external-context.reviewed.json`). If present, hold it as shared context for tier 2 and every tier-4 analyzer. If absent, proceed — it is best-effort, never required.
- [ ] **Decompose first.** Invoke `decompose-into-transcript-segments` with `tmp_dir`. It produces `segments.json` and `flamegraph.html` in `tmp_dir`. Do **not** walk raw JSONL from this skill — that's tier 2's job, exclusively.
- [ ] Load `segments.json`. The Segment tree is now the unit of analysis.
- [ ] For each Segment, in tree order (parent before children, or vice versa — the analyzers don't care, but findings reference Segment ids), run the per-Segment analyzers in this order:
  - [ ] **Outcomes bucket** (always):
    - [ ] `analyze-segment-efficiency` — runs on every Segment
    - [ ] `analyze-failure-hypothesis` — runs only when the Segment's Outcome is Failure, or when the next sibling Segment opens with a Correction trigger (retro-Failure). Both `source: user` and `source: agent` Corrections qualify; user-source is the stronger signal
  - [ ] **Prompts bucket** (only on Segments with `trigger.source == "user"`):
    - [ ] `analyze-user-prompt` — on every Segment whose Trigger came from a user message
    - [ ] `analyze-prompt-ambition` — only on Segments with `trigger.kind == "New" && trigger.source == "user"` (the user-typed Initial case)
  - [ ] **Skills bucket** (every Segment):
    - [ ] `analyze-skill-trigger-performance`
    - [ ] `analyze-skill-action-performance`
    - [ ] `analyze-skill-gaps` — seeded by any `recommendation_seed` from this Segment's failure hypothesis
  - [ ] **MCP bucket** (every Segment):
    - [ ] `analyze-mcp-trigger-performance`
    - [ ] `analyze-mcp-action-performance`
    - [ ] `analyze-mcp-gaps` — seeded by any `recommendation_seed` from this Segment's failure hypothesis and any deterministic-trigger candidate from `analyze-prompt-ambition`
- [ ] Aggregate per-Segment recommendations across the whole session, deduping similar suggestions
- [ ] Cross-reference each surviving recommendation against the philosophy docs; drop those that contradict, or note the contradiction so the human reviewer can resolve it
- [ ] Compute the **distance from ideal end-state** section (counts of Failures; Correction triggers broken out by user-source vs agent-source; deterministic-trigger candidates among user-source New triggers; total wall-clock vs counterfactual sum). Per the `transcript-segment` reference, this is the north-star metric block
- [ ] Emit the Markdown report and the JSON sidecar. Reference `segments.json` and `flamegraph.html` paths but do not re-emit their contents

## Out of scope

- Acquiring the transcript — that's `get-claude-code-transcript`.
- Producing `segments.json` — that's `decompose-into-transcript-segments`.
- The actual per-Segment scoring — that's the tier-4 analyzers below this orchestrator.
- Cross-session patterns — that's `analyze-cross-transcript-patterns` in tier 5.
