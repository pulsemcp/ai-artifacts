# Transcript Segment

The central data primitive of the `agent-transcript-analysis` plugin. Every analysis skill consumes Transcript Segments, not raw JSONL.

## Definition

A **Transcript Segment** is a coherent unit of agent work. Recursively defined:

```
Segment {
  trigger:   Trigger        // exactly 1 — what caused this Goal to exist
  goal:      Goal           // exactly 1
  outcome:   Outcome        // exactly 1
  children:  Segment[]      // 1 or more sub-segments
  meta:      { turn_range, wall_clock, tokens_in, tokens_out, model, ... }
}
```

The triplet **Trigger → Goal → Outcome** is the spine: cause, intent, result. A full Transcript is itself a Transcript Segment (the root). It has children, and so on, down to leaf segments whose `children` is empty (or a single trivially-atomic action).

### Goal

Exactly one per segment. Two kinds:

- **Plan** — figuring out what to do or how to do it. Reading code, searching, asking clarifying questions, drafting an approach.
- **Action** — doing the thing. Editing files, running commands that change state, opening PRs.

A segment's Goal is named in one sentence: *"plan the migration"*, *"add the auth middleware"*, etc.

### Outcome

Exactly one per segment. Two kinds:

- **Success** — the Goal was achieved.
- **Failure** — the Goal was not achieved (got the wrong answer, broke the build, gave up, ran out of context, etc.).

Outcome is judged against the Goal, not against some abstract notion of quality. A segment whose Goal was "investigate" succeeds when the investigation produces a defensible answer, even if the answer is "no, we shouldn't do this."

### Trigger

Exactly one per segment. The Trigger captures **what caused this Goal to exist**. Two independent dimensions:

**`kind`** — the relationship to the previous segment's work:

- **New** — a fresh Goal, not derived from correcting prior work. Either a brand-new line of work, or the next step in a sequence after the previous segment landed cleanly.
- **Correction** — the Goal exists *because* the previous segment didn't deliver. Course-correcting, retrying with a different framing, undoing damage, fixing what broke.

**`source`** — who originated the Goal shift:

- **user** — a user message defined the new Goal. `trigger.turn` and `trigger.text` are populated with the message.
- **agent** — the main-thread agent pivoted on its own, with no user message in between. `turn`/`text` are absent.
- **subagent** — a parent agent's `Task` / `Agent` tool call spawned this segment. `trigger.turn` points at the Task call in the parent's JSONL and `trigger.text` is the prompt passed to the subagent.

The two dimensions are independent. The four cases that matter most:

| `kind` | `source` | Meaning |
|---|---|---|
| New | user | What used to be called an **Initial Prompt** — a user message launching a fresh Goal. The deterministic-trigger candidate analysis runs on these. |
| Correction | user | What used to be called a **Correction Prompt** — strongest retro-Failure signal on the prior segment. The user had to step in. |
| Correction | agent | The agent noticed it was wrong and pivoted on its own. Softer retro-Failure signal, but still real — the prior segment didn't deliver. |
| New | agent | The agent moved to the next step in its plan. Normal sequencing, not a Failure signal. |

The presence of a Correction trigger — from either source — retroactively marks the prior sibling segment as Failure even if the agent didn't itself recognize the failure. User-source Corrections are the stronger signal (the user had to intervene); agent-source Corrections are softer but still inform the failure analysis.

### Children

One or more sub-segments. A segment's children must collectively account for everything between the segment's start and end turns. Leaf segments may have a single trivially-atomic action as their sole "child" or, by convention, an empty list.

## Ideal end-state

The north star a Transcript should be measured against — not because real transcripts hit it, but because deviations are where the analyzers focus:

- **Root segment**: 1 Goal, `trigger.kind = New` with `source = user`, 1 Success Outcome.
- **Children**: a mix of Plan and Action segments, **all with Success Outcomes**.
- **No** Failure Outcomes anywhere in the tree.
- **No** Correction triggers anywhere in the tree — neither user-source (user had to step in) nor agent-source (the agent pivoted off a wrong path).
- Achieved in the minimum token-spend and wall-clock time that's reasonable for the work.

End-state for the *root* user-source New trigger in particular: it should originate from a **deterministic trigger reacting to an external event** (alerts, schedule, PR opening, etc.) rather than ad-hoc human typing. Ad-hoc human-typed roots are accepted but counted; the trend should be down over time.

## Segmentation methodology

A Segment boundary is exactly where the **Goal changes**. Every rule below is a way of detecting that change. If a heuristic fires but the Goal hasn't actually shifted, don't draw a boundary — keep the work in the current Segment.

### Boundary triggers

Three signals that should prompt the decomposer to draw a new Segment:

1. **New user message.** The Goal can change at any user message. The new Segment's `trigger.source = user` with `trigger.turn` / `trigger.text` set to the message.
   - New line of work → sibling Segment with `trigger.kind = New`.
   - User steering after seeing the prior Segment's output ("actually do X", "no, I meant Y", "you broke Z") → sibling Segment with `trigger.kind = Correction`. This retroactively marks the prior sibling as Failure.
   - **Multi-Goal message** (one message asking for two unrelated things — "fix the auth bug, and bump lodash"): draw *one Segment per Goal* as siblings. All siblings share `trigger.turn` pointing at the same user turn; their `meta.turn_range`s partition the agent's response turns by which Goal each addressed.
   - **Continuation-only messages** ("continue", "go on", "yes") do *not* start a new Segment — the Goal is unchanged.
   - **Re-statement with extra context** (the user adds a fact but the Goal is the same) does *not* start a new Segment either; the agent's Goal didn't change, the user just helped.

2. **Subagent spawn.** A `Task` / `Agent` tool call always starts a child Segment with `trigger.source = subagent`, `trigger.turn` pointing at the Task call in the parent's JSONL, and `trigger.text` set to the prompt passed to the subagent. `meta.source` is the subagent's JSONL file. The child's `trigger.kind` is almost always `New` (the parent is delegating fresh work); use `Correction` only if the parent explicitly framed the spawn as fixing a prior subagent run. The child's lifetime is the subagent's full turn range; control returns to the parent at the next main-thread turn.

3. **Topic / file shift within a single agent turn-run.** Between two user messages, the agent can pivot to a new Goal on its own ("now let me run the tests" after the edits land). New Segment's `trigger.source = agent`; no `turn`/`text`. Draw a child Segment only when *all three* hold:
   - The agent verbalizes the shift, **or** the tool-call mode changes (read-only ↔ state-mutating).
   - The targets (files, commands, MCP tools) are disjoint from the prior run's targets.
   - The next several turns continue on the new target — not one stray tool call before returning.

   A single stray tool call (e.g. one `Read` while in the middle of editing) is **not** a boundary.

   Classify `trigger.kind` for an agent-source shift as `Correction` when the pivot is clearly a course-correction ("that didn't work, let me try X", agent reads a tool error and abandons the approach, revert of prior edits). Otherwise `New` — the agent is sequencing through its plan.

### Leaf-stop rule

Stop subdividing when **any** of:

- The candidate sub-Segment is short enough that splitting it out carries no analytical signal (heuristic: < ~5 turns or < ~30 s wall-clock).
- The Segment serves a single narrowly-scoped Goal that can't be meaningfully split ("write this one function").
- Further decomposition would produce mechanical sub-steps ("call the function", "check the return value") rather than Goals an analyzer would attach a recommendation to.

Bias toward fewer, more meaningful Segments. Every Segment costs an analyzer pass per tier-4 bucket; a Segment that produces zero findings across all buckets is a sign it shouldn't have been split out.

### What a Segment is *not*

- A single tool call in isolation (unless it's a `Task` / `Agent` spawn).
- A pure thinking turn with no tool use and no state change.
- The agent's own retries of the same operation — those stay inside the current Segment; the retries are part of the Goal's effort.

### When in doubt

The decomposer's worst failure mode is **over-segmentation** — a tree so fine-grained that every analyzer fires on noise. If you can't name the Goal change in one sentence, there isn't one. Keep the work in the current Segment.

## Per-segment failure stack

When analyzing a Segment, look for these in order. Anything that fires becomes an improvement hypothesis attached to the Segment.

1. **Failure Outcome** — must produce an improvement hypothesis. Always.
2. **Correction trigger** at the head of (or following) the Segment — must produce an improvement hypothesis. Stronger for `source: user`, softer but still actionable for `source: agent`. Unless explicitly classified as a user mistake ("do better, human"), the hypothesis defaults to one of:
   - missing Skill (no Skill existed to prevent the wrong turn)
   - non-triggering Skill (a Skill existed but its description didn't fire)
3. **Unambitious user-source New trigger** — Success Outcome but short wall-clock and followed by another user-source New trigger soon after. Likely the user split work that could have been one ambitious prompt.
4. **Wasteful branches** — the Segment spent time on detours that, in hindsight, weren't on the critical path. Where did the time go? Was there a different framing that would have skipped the detour?
5. **Model-tier mismatch** — could a smaller model have served this Segment without quality loss? Or was the model too small and the Segment thrashed?

## Output contract

`2-decompose/decompose-into-transcript-segments` emits **both**:

1. **`segments.json`** — the structured tree. Every analyzer in tier 4 reads this, not the raw JSONL. Schema and example below.
2. **`flamegraph.html`** — annotated visualization. The X axis is wall-clock time; the Y axis is Segment depth. Each block is color-coded by Outcome (green = Success, red = Failure) with a badge for any Correction trigger at the Segment's head (badge variant indicates `source: user` vs `source: agent`). Hover/click reveals the Goal text and meta.

Both must agree. Downstream analyzers read `segments.json`; the flamegraph is for humans reviewing the report.

### `segments.json` schema

The file is a single JSON document whose top-level value is the root Segment of the Transcript. Every Segment carries the same shape:

```jsonc
{
  "id":      "S0",                          // string, unique within the file, stable across re-runs
  "trigger": {
    "kind":   "New",                        // "New" | "Correction"
    "source": "user",                       // "user" | "agent" | "subagent"
    "turn":   0,                            // index into the relevant JSONL; null when source = agent
    "text":   "add auth middleware that validates JWTs..."  // null when source = agent
  },
  "goal": {
    "text":  "Add auth middleware to the Express app",
    "kind":  "Action"                       // "Plan" | "Action"
  },
  "outcome": {
    "kind":  "Success",                     // "Success" | "Failure"
    "evidence_turns": [45, 47]              // turns that justify the call; may be empty
  },
  "children": [ /* sub-Segments, same shape; [] is allowed for leaves */ ],
  "meta": {
    "turn_range":   [0, 47],                // inclusive on both ends; indexes into main.jsonl
    "wall_clock_s": 1820,
    "tokens_in":    18200,
    "tokens_out":    6400,
    "model":        "claude-sonnet-4-6",
    "source":       "main"                  // "main" | "subagents/<file>" — which JSONL this Segment lives in
  }
}
```

Rules a Segment tree must satisfy:

- **Exactly one `trigger`, one `goal`, one `outcome`** per Segment.
- **Trigger consistency**: when `trigger.source` is `user` or `subagent`, both `trigger.turn` and `trigger.text` are populated, and `trigger.turn` must fall inside `meta.turn_range` (for `subagent`, the turn lives in the parent's JSONL — see `meta.source` to disambiguate). When `trigger.source = agent`, both `turn` and `text` are `null`.
- **Root rule**: the root Segment's `trigger.source` is `user` (or `subagent` if this whole transcript is itself a delegated run); `trigger.kind` is `New`.
- **Coverage**: a Segment's `children` must collectively cover its `meta.turn_range` with no gaps and no overlaps. Leaves have `children: []`.
- **`id` stability**: ids are deterministic for a given input (e.g. depth-first numbering: `S0`, `S0.0`, `S0.1`, `S0.1.0`). Analyzers reference Segments by `id`; the orchestrator round-trips ids in its report.
- **Outcome is local to the Goal**: a Success Segment can sit under a Failure parent and vice versa. Do not propagate up.

### Example

A short session: user asks for an auth middleware, the agent plans, writes the validator (breaks a test), is Corrected by the user, fixes it, then wires it up. The example exercises all four Trigger cases: user-source New (root), agent-source New (sequencing), agent-source Correction (agent self-corrected mid-edit), and user-source Correction (user stepped in).

```json
{
  "id": "S0",
  "trigger": {
    "kind": "New",
    "source": "user",
    "turn": 0,
    "text": "Add auth middleware that validates JWTs from the Authorization header and rejects expired tokens. Wire it into app.ts before the routes."
  },
  "goal":    { "text": "Add JWT auth middleware to the Express app", "kind": "Action" },
  "outcome": { "kind": "Success", "evidence_turns": [46, 47] },
  "meta": {
    "turn_range": [0, 47],
    "wall_clock_s": 1820,
    "tokens_in": 18200,
    "tokens_out": 6400,
    "model": "claude-sonnet-4-6",
    "source": "main"
  },
  "children": [
    {
      "id": "S0.0",
      "trigger": { "kind": "New",        "source": "agent", "turn": null, "text": null },
      "goal":    { "text": "Read the existing middleware stack", "kind": "Plan" },
      "outcome": { "kind": "Success", "evidence_turns": [4, 9] },
      "meta":    { "turn_range": [1, 9],   "wall_clock_s": 140, "tokens_in": 2100, "tokens_out": 350,  "model": "claude-sonnet-4-6", "source": "main" },
      "children": []
    },
    {
      "id": "S0.1",
      "trigger": { "kind": "New",        "source": "agent", "turn": null, "text": null },
      "goal":    { "text": "Write the JWT validator (first attempt — wrong signature algorithm)", "kind": "Action" },
      "outcome": { "kind": "Failure", "evidence_turns": [16, 17] },
      "meta":    { "turn_range": [10, 17], "wall_clock_s": 280, "tokens_in": 2600, "tokens_out": 950,  "model": "claude-sonnet-4-6", "source": "main" },
      "children": []
    },
    {
      "id": "S0.2",
      "trigger": { "kind": "Correction", "source": "agent", "turn": null, "text": null },
      "goal":    { "text": "Rewrite the validator with the correct RS256 algorithm", "kind": "Action" },
      "outcome": { "kind": "Failure", "evidence_turns": [22, 24] },
      "meta":    { "turn_range": [18, 24], "wall_clock_s": 340, "tokens_in": 2800, "tokens_out": 1150, "model": "claude-sonnet-4-6", "source": "main" },
      "children": []
    },
    {
      "id": "S0.3",
      "trigger": {
        "kind": "Correction",
        "source": "user",
        "turn": 25,
        "text": "you broke users.spec.ts:42 — the test asserts a 401 when the token is missing; fix it"
      },
      "goal":    { "text": "Fix the broken users.spec.ts:42 auth test", "kind": "Action" },
      "outcome": { "kind": "Success", "evidence_turns": [38, 40] },
      "meta":    { "turn_range": [25, 40], "wall_clock_s": 720, "tokens_in": 7300, "tokens_out": 2900, "model": "claude-sonnet-4-6", "source": "main" },
      "children": []
    },
    {
      "id": "S0.4",
      "trigger": { "kind": "New",        "source": "agent", "turn": null, "text": null },
      "goal":    { "text": "Wire middleware into app.ts before the route mounts", "kind": "Action" },
      "outcome": { "kind": "Success", "evidence_turns": [46, 47] },
      "meta":    { "turn_range": [41, 47], "wall_clock_s": 340, "tokens_in": 3400, "tokens_out": 1050, "model": "claude-sonnet-4-6", "source": "main" },
      "children": []
    }
  ]
}
```

What this example demonstrates:

- **All four Trigger cases.** Root is user-source New. `S0.0`, `S0.1`, `S0.4` are agent-source New (the agent sequencing through its plan). `S0.2` is agent-source Correction (the agent noticed its own wrong algorithm choice and rewrote). `S0.3` is user-source Correction (the user had to step in about the broken test).
- **Both Correction sources produce retro-Failure signals.** `S0.1` is `Failure` because `S0.2`'s agent-source Correction trigger retroactively confirms the validator was wrong. `S0.2` is `Failure` because `S0.3`'s user-source Correction trigger retroactively confirms even the rewrite wasn't right. User-source Correction is the stronger signal — the agent didn't self-recover.
- **Local Outcome.** `S0.1` and `S0.2` are both `Failure` even though their parent `S0` is `Success`. Failures do not propagate up.
- **Coverage.** Turn ranges `[1,9]`, `[10,17]`, `[18,24]`, `[25,40]`, `[41,47]` partition the root's `[0,47]` (turn 0 is the Initial trigger itself, attached to the root). No gaps, no overlaps.
- **Plan vs Action.** `S0.0` (read-only investigation) is Plan; the writes that follow are Action.

## Notes for analyzer authors

- **The Segment is the analysis unit, not the message.** Don't write analyzers that walk raw turns; ask the orchestrator for the relevant Segment(s).
- **Recursion is real.** A Failure inside a Success is common (the agent recovered). Don't collapse trees prematurely.
- **Outcome is per-Goal.** A Segment that "shipped the wrong feature" had Success on its stated Goal and a Failure higher up the tree. Don't propagate failures up automatically — that's the orchestrator's call.
