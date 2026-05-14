---
name: pull-together-goal-context
description: >
  Build context around what a user was trying to accomplish in a Transcript
  Segment when the Goal is not self-evident from the user message
  (segment.trigger.text) alone. Reaches into git repos (commits, PRs,
  branch state at the time of the session), issue trackers, and any other
  systems referenced in the message. Use this skill when
  analyze-user-prompt cannot confidently confirm a Goal.
user-invocable: false
---

# Pull together goal context

Helper for `analyze-user-prompt`. Pulls just enough external context to make a low-confidence Goal extraction high-confidence.

## Inputs

- `segment`: the Segment whose Goal needs disambiguation. The user message lives in `segment.trigger.text` (when `trigger.source == "user"`); turn_range lives in `segment.meta.turn_range`
- `segment_turns`: the raw turns within `segment.meta.turn_range` — surrounding turns may name a file, a PR, an issue, a service, etc.
- `manifest`: gives `project_path`, branch (if recorded), session timestamps

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

## Sequencing checklist

- [ ] Inventory the references in `segment.trigger.text` and `segment_turns` (file paths, PR/issue numbers, branch names, service names, commit shas, ticket ids)
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
