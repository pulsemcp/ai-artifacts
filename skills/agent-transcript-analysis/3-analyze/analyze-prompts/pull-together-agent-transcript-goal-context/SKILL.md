---
name: pull-together-agent-transcript-goal-context
description: >
  Build context around what a user was trying to accomplish in a Transcript
  Segment when the Goal is not self-evident from the user message
  (segment.trigger.text) alone. Reaches into git repos (commits, PRs,
  branch state at the time of the session), issue trackers, and any other
  systems referenced in the message. Use this skill when
  analyze-agent-transcript-user-prompt cannot confidently confirm a Goal.
user-invocable: false
---

# Pull together goal context

Helper for `analyze-agent-transcript-user-prompt`. Pulls just enough external context to make a low-confidence Goal extraction high-confidence.

## Inputs

- `segment`: the Segment whose Goal needs disambiguation. The user message lives in `segment.trigger.text` (when `trigger.source == "user"`); the event span lives in `segment.meta.event_range`.
- `transcript.json`: the OpenTranscripts `Transcript` document. Dereference event ids from `segment.meta.event_range` into `transcript.json` `events[]` for the surrounding events — they may name a file, a PR, an issue, a service, etc.
- `external_context` (optional): `external-context.json` if present — supplies `project`, branch, ticket, and session-timing context, often resolving the Goal without any external pull.

## Output

```json
{
  "goal": "<refined one-sentence goal>",
  "goal_certainty": "high" | "medium" | "low",
  "evidence": [
    {"source": "git" | "github_pr" | "github_issue" | "linear" | "...", "ref": "...", "snippet": "..."}
  ],
  "still_unclear": "<what remains ambiguous, if anything>"
}
```

This is a helper invoked by `analyze-agent-transcript-user-prompt`, not an analyzer the orchestrator writes into a `findings.<kind>.json` — its output is consumed in-process, so it carries no `id` / `segment_id` / `analyzer` wrapper.

## Sequencing checklist

- [ ] Inventory the references in `segment.trigger.text`, `external_context`, and the events in `segment.meta.event_range` (file paths, PR/issue numbers, branch names, service names, commit shas, ticket ids)
- [ ] For each reference, pull the smallest amount of external context that resolves the ambiguity:
  - **Git**: `git log` around the session timestamp, `git show <sha>`, the diff on the branch at that time
  - **GitHub PRs/issues**: `gh pr view`, `gh issue view`, including the description and the most recent few comments
  - **Other trackers / docs**: only if directly named in the prompt and an MCP / CLI is available
- [ ] Stop as soon as the Goal is high-confidence — do not bulk-pull
- [ ] Return the refined Goal and the evidence supporting it

## Notes

- This skill is **read-only**. It must not modify any external system, even by accident. No comments on PRs, no edits to issues, no force-pushes.
- Be aggressive about delegating verbose external pulls (full PR threads, large diffs) to a subagent so the analysis context window stays small.
- If after reasonable effort the Goal is still unclear, return `goal_certainty: "low"` with `still_unclear` populated. The orchestrator will mark the Segment "tentative" rather than fabricate a Goal.
