---
name: decompose-into-transcript-segments
description: >
  Given the tmp folder produced by get-one-claude-code-transcript, decompose
  the transcript into a recursive tree of Transcript Segments (see
  references/transcript-segment.md). Each Segment carries a Trigger (kind:
  New | Correction × source: user | agent | subagent), a Goal (Plan |
  Action), an Outcome (Success | Failure), child sub-segments, and a meta
  block (turns, wall-clock, tokens, model). Emits segments.json
  (structured) and flamegraph.html (annotated). All tier-4 analyzers read
  segments.json — they never walk raw JSONL. Use this skill immediately
  after acquisition and before any analyze-* skill.
user-invocable: false
---

# Decompose into transcript segments

The Transcript Segment primitive (`references/transcript-segment.md`) is the spine of every downstream analyzer. This skill is the only thing that produces it.

## Inputs

- `tmp_dir` (required): output of `get-one-claude-code-transcript`. Must contain `manifest.json`, `main.jsonl`, optional `subagents/`.

## Outputs

Two files written into `tmp_dir`:

- **`segments.json`** — the structured tree. **Schema and a worked example live in [`references/transcript-segment.md`](../../../../references/transcript-segment.md) under "`segments.json` schema" and "Example"** — they are the contract this skill must hit. Validate against the rules listed there (exactly one Trigger/Goal/Outcome per Segment; `trigger.turn` inside the Segment's turn_range when source ∈ {user, subagent}; children cover the parent's turn_range with no gaps or overlaps; deterministic `id`s).
- **`flamegraph.html`** — annotated flamegraph. X = wall-clock, Y = Segment depth. Color = Outcome (green Success, red Failure). Badge = Correction trigger at head, with the badge variant indicating `source: user` vs `source: agent`. Hover/click reveals Goal text and meta.

Both must agree. Downstream skills read `segments.json`; humans look at `flamegraph.html`.

## Sequencing checklist

- [ ] Load `manifest.json` + JSONL files from `tmp_dir`
- [ ] **Identify segment boundaries** by following the `## Segmentation methodology` section of [`references/transcript-segment.md`](../../../../references/transcript-segment.md). That section is the source of truth — boundary triggers (new user message, subagent spawn, within-run topic/file shift), the leaf-stop rule, and what a Segment is *not* all live there
- [ ] **Label each segment's Goal** in one sentence and classify it as **Plan** (figuring out) or **Action** (doing/changing state). When ambiguous, default to Plan
- [ ] **Label each segment's Outcome** as **Success** or **Failure** against its own Goal — not against a higher Goal. A successful sub-step under a failed parent is Success
- [ ] Recurse: every segment's children must collectively cover its turn range
- [ ] Compute `meta` per segment: turn range, wall-clock, tokens in/out, model used
- [ ] Emit `segments.json` and the annotated `flamegraph.html`
- [ ] Print both paths to stdout for the orchestrator

## Heuristics for labeling

- **Correction triggers from the user**: user messages that contain "actually", "no, I meant", "that's wrong", "you missed", or that re-issue a similar instruction to the prior turn, get `trigger.kind = Correction` (with `trigger.source = user`). Otherwise `kind = New`
- **Correction triggers from the agent**: agent-source pivots that explicitly walk back prior work ("that didn't work, let me try X", agent reads a tool error and abandons the approach, revert of prior edits) get `trigger.kind = Correction` (with `trigger.source = agent`). Plain sequencing into the next step of the plan stays `kind = New`
- **Failure Outcome (most reliable signal)**: a Correction trigger at the *next* segment's head retroactively marks the prior segment as Failure, even if the agent looked confident. User-source Correction is the stronger signal; agent-source Correction is softer but still real
- **Failure Outcome (other signals)**: build/test broke and wasn't fixed; agent gave up explicitly; ran out of context mid-Goal; subagent returned with an unrecovered error
- **Plan vs Action**: tool calls that mutate state (Edit, Write, Bash with side effects, gh pr create, mcp tools that write) are Action. Read-only tool calls are Plan

## Out of scope

- Acquiring the transcript — `get-one-claude-code-transcript` already did that
- Any analysis or recommendation — every `analyze-*` skill is downstream of this
- Cross-transcript work — that's tier 5

## Notes

- The flamegraph is a humanizing artifact — the analyzers don't read it. Prioritize correctness of `segments.json` over flamegraph polish.
- Token cost matters; this skill is the only place we walk every turn, so do it once and let downstream skills consume the structured output.
