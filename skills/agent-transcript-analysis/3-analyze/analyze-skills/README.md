# `analyze-skills` bucket

The Skills recommendation bucket — three analyzers covering existing Skills and missing Skills:

- `analyze-agent-transcript-skill-trigger-performance/` — Skills that fired but shouldn't have, or should have fired but didn't (issue lives in the `description`)
- `analyze-agent-transcript-skill-action-performance/` — Skills that ran: did they help? at what cost? (issue lives in the body)
- `analyze-agent-transcript-skill-gaps/` — Skills that *should exist but don't*

## How the skills interplay

`analyze-agent-transcript` runs all three per Segment. They're deliberately complementary:

- **Trigger** asks "right Skill at the right time?"
- **Action** asks "Skill body did the right thing once invoked?"
- **Gaps** asks "would a Skill that doesn't exist yet have changed the outcome?"

A finding usually belongs to exactly one of the three; misclassification dilutes the recommendation. Each skill's docs spell out which bucket owns which kind of finding.

## Design decisions

- **Trigger ≠ action.** Distinguishing description problems from body problems lets recommendations be precise. A "wrong Skill fired" recommendation is to tighten a `description`; a "right Skill ran but produced bad output" recommendation is to edit the body.
- **Gaps is opinionated.** Proposals must include a concrete `description` and a 5-line body sketch — vague "be smarter about X" findings are dropped.
- **Philosophy doc is the source of truth for create/modify/delete calls.** Each analyzer cross-checks the `philosophy-on-skills` reference before emitting a recommendation.
- **Zero is a valid answer.** Clean Segments produce no recommendations here.
- **Reads `segments.json`, not JSONL.** All three analyzers operate on Segments handed in by the orchestrator — they never re-walk raw turns.
