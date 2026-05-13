---
name: analyze-user-prompt
description: >
  Analyze a single user prompt within a transcript segment. Classify it
  (question vs. delegation), extract the goal, and assess whether the segment
  was closed-loop on that goal. If the goal isn't self-evident from the
  prompt and surrounding context, delegate to pull-together-goal-context.
  Output feeds the "human prompting" recommendation bucket of
  analyze-agent-transcript.
user-invocable: false
---

# Analyze user prompt

Per-prompt analyzer. Invoked once per segment by `analyze-agent-transcript`.

## Inputs

- `prompt_text`: the user message
- `segment_messages`: the full segment of messages this prompt initiated
- `manifest`: from the tmp folder, for project / branch / repo context

## Output

```json
{
  "classification": "question" | "delegation" | "mixed",
  "goal": "<one-sentence summary of what the user wanted>",
  "goal_certainty": "high" | "medium" | "low",
  "closed_loop": true | false,
  "loop_break_reason": "<why the loop didn't close, if applicable>",
  "issues": [
    {"kind": "ambiguous" | "missing_context" | "wrong_target" | "too_broad" | "...", "evidence": "...", "fix": "..."}
  ],
  "prompting_recommendation": "<what the user should have written instead, or null>"
}
```

## Sequencing checklist

- [ ] Classify the prompt: is it a **question** (the user wants information back), a **delegation** (the user wants the agent to do something), or **mixed**?
- [ ] Extract the **goal** in one sentence. If `goal_certainty` would be `low`, invoke `pull-together-goal-context` with the project/branch info from the manifest before giving up
- [ ] Determine whether the segment **closed the loop** on that goal:
  - Did the final assistant message answer the question / complete the delegation?
  - Or did the user have to send a follow-up that suggests the loop *didn't* close (correction, re-ask, "you missed X", "actually I meant Y")?
- [ ] Identify prompting issues (the three failure modes from the team's heuristics):
  - **Incorrect** — the user asked for the wrong thing
  - **Ambiguous** — the prompt left room for interpretation that hurt the outcome
  - **Missing context** — the agent could only have succeeded with information the user didn't provide
- [ ] If a prompting issue is the root cause of the failure, write a concrete `prompting_recommendation` showing what a better version of the prompt would have looked like

## Notes

- The follow-up-prompt heuristic from the team's playbook is the single strongest signal here: any session that was *meant* to be one-shot but received a corrective follow-up is a candidate for either a prompting fix, a Skill, or an MCP server.
- Don't recommend a Skill or MCP change here — that's the job of `analyze-skill-gaps` / `analyze-mcp-gaps`. Stay in the prompting bucket.
