# `analyze-agent-transcript-skill-trigger-performance`

Per-segment analyzer focused on **Skill `description` fields** — what makes a Skill fire and what keeps it silent.

## How it plugs in

Invoked once per segment by `analyze-agent-transcript`. Companion to `analyze-agent-transcript-skill-action-performance` (the body) and `analyze-agent-transcript-skill-gaps` (the missing).

Output is a list of false positives (Skills that fired when they shouldn't have) and false negatives (Skills that should have fired but didn't).

## Design decisions

- **Trigger vs action.** A Skill that fired correctly but produced bad output is **not** a false positive here — that's an action-performance finding. Keeping the buckets clean keeps the recommendations precise.
- **Modify ≫ delete.** Default recommendation is to narrow / sharpen the `description`. Delete is reserved for Skills that misfire consistently and can't be saved by a description tweak.
- **Cite the moment.** Every recommendation must point to the exact turn that motivated it, so the human reviewer can see whether the call is defensible.
