---
name: decompose-into-transcript-segments
description: >
  Given the tmp folder produced by get-claude-code-transcript (containing
  transcript.json — an OpenTranscripts Transcript document), decompose the
  transcript into a recursive tree of Transcript Segments (see the
  transcript-segment reference). Each Segment
  carries a Trigger (kind: New | Correction × source: user | agent |
  subagent), a Goal (Plan | Action), an Outcome (Success | Failure), child
  sub-segments, and a meta block (event range, wall-clock, tokens, model).
  Emits segments.json (structured) and flamegraph.html (annotated). All
  tier-4 analyzers read segments.json — they never walk transcript.json
  events directly. Use this skill immediately after acquisition and before
  any analyze-* skill.
user-invocable: false
---

# Decompose into transcript segments

The Transcript Segment primitive (defined in the `transcript-segment` reference) is the spine of every downstream analyzer. This skill is the only thing that produces it.

## Inputs

- `tmp_dir` (required): output of `get-claude-code-transcript`. Must contain `transcript.json` (an OpenTranscripts `Transcript` document, possibly with nested subagents).

## Outputs

Two files written into `tmp_dir`:

- **`segments.json`** — the structured tree. **Schema and a worked example live in the `transcript-segment` reference under "`segments.json` schema" and "Example"** — they are the contract this skill must hit. Validate against the rules listed there (exactly one Trigger/Goal/Outcome per Segment; `trigger.event_id` points at a real event id when `source ∈ {user, subagent}`; children cover the parent's `event_range` with no gaps or overlaps; deterministic `id`s).
- **`flamegraph.html`** — annotated flamegraph. X = wall-clock, Y = Segment depth. Color = Outcome (green Success, red Failure). Badge = Correction trigger at head, with the badge variant indicating `source: user` vs `source: agent`. Hover/click reveals Goal text and meta.

Both must agree. Downstream skills read `segments.json`; humans look at `flamegraph.html`.

## Sequencing checklist

- [ ] Load `transcript.json` from `tmp_dir`. Walk the recursive structure: the root Transcript's `events[]` plus every `subagents[*].events[]` (recursively)
- [ ] **Identify segment boundaries** by following the `## Segmentation methodology` section of the `transcript-segment` reference. That section is the source of truth — boundary triggers (new `UserMessage` event, `SubagentSpawn` event, within-run topic/file shift), the leaf-stop rule, and what a Segment is *not* all live there
- [ ] **Label each segment's Goal** in one sentence and classify it as **Plan** (figuring out) or **Action** (doing/changing state). When ambiguous, default to Plan
- [ ] **Label each segment's Outcome** as **Success** or **Failure** against its own Goal — not against a higher Goal. A successful sub-step under a failed parent is Success
- [ ] Recurse: every segment's children must collectively cover its `event_range`
- [ ] Compute `meta` per segment: event_range (first/last event ids), wall-clock, tokens in/out (sum of `AssistantMessage.usage.input_tokens`/`output_tokens` for events in range), model used, `source_transcript_id` (the OT Transcript whose `events[]` this Segment covers)
- [ ] Emit `segments.json` and the annotated `flamegraph.html`
- [ ] Print both paths to stdout for the orchestrator

## Heuristics for labeling

- **Correction triggers from the user**: `UserMessage` events whose content contains "actually", "no, I meant", "that's wrong", "you missed", or that re-issue a similar instruction to the prior turn, get `trigger.kind = Correction` (with `trigger.source = user`). Otherwise `kind = New`
- **Correction triggers from the agent**: agent-source pivots that explicitly walk back prior work ("that didn't work, let me try X", agent reads a `ToolResult` with `is_error: true` and abandons the approach, revert of prior edits) get `trigger.kind = Correction` (with `trigger.source = agent`). Plain sequencing into the next step of the plan stays `kind = New`
- **Failure Outcome (most reliable signal)**: a Correction trigger at the *next* segment's head retroactively marks the prior segment as Failure, even if the agent looked confident. User-source Correction is the stronger signal; agent-source Correction is softer but still real
- **Failure Outcome (other signals)**: build/test broke and wasn't fixed; agent gave up explicitly; ran out of context mid-Goal (look for `Compaction` followed by `UserMessage` with course-correcting content); subagent returned with an unrecovered error
- **Plan vs Action**: `ToolCall` events that mutate state (Edit, Write, Bash with side effects, gh pr create, mcp tools that write) are Action. Read-only `ToolCall`s are Plan

## Reading the Transcript

- **Event ids are the primary key.** Every `meta.event_range`, `trigger.event_id`, and `outcome.evidence_event_ids` references real `Event.id` values inside `transcript.json`. The orchestrator dereferences these as needed; don't denormalize event content into `segments.json`.
- **Subagent spawns are first-class.** A `SubagentSpawn` event in the parent's `events[]` always corresponds to an entry in the parent's `subagents[]`. The subagent's Segment subtree's `meta.source_transcript_id` is the child Transcript's `transcript_id`.
- **Token totals** come from summing `AssistantMessage.usage.input_tokens` / `output_tokens` over the events in range. `final_metrics` at the Transcript level is the global roll-up, not authoritative per Segment.

## Out of scope

- Acquiring the transcript or transforming CC JSONL — that's tier 1.
- Any analysis or recommendation — every `analyze-*` skill is downstream of this.
- Cross-transcript work — that's tier 5.

## Notes

- The flamegraph is a humanizing artifact — the analyzers don't read it. Prioritize correctness of `segments.json` over flamegraph polish.
- Token cost matters; this skill is the only place we walk every event, so do it once and let downstream skills consume the structured output.
- **`segments.json` is a draft.** Decomposition is the most interpretive step in the pipeline, so its output is meant to be reviewed: `review-transcript-segments` lets a human audit and correct the tree into `segments.reviewed.json`, and `learn-from-segment-corrections` reads those corrections to flag improvement opportunities for this skill's heuristics. Emit your best draft, but don't treat it as final.
