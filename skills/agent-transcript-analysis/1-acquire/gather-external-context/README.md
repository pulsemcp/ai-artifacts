# `gather-external-context`

Tier 1's context-gathering step. Pulls the ticket, the pull request, and the user's background into one `external-context.json` that travels with the transcript.

## Why this exists

A transcript is a record of *what the agent did*. Analysis needs *why it was doing it* — the ticket behind the work, the PR it turned into, who the user is and what project they're on. Without that, every downstream judgment ("was this Segment a Failure?", "was the Goal closed?") is made in a vacuum.

`get-claude-code-transcript-from-local` gives you the *what*. This skill gathers the *why*, once, up front, so tiers 2-5 never have to.

## Where it sits

```
get-claude-code-transcript-from-local  →  transcript.json
gather-external-context                →  external-context.json           (this skill)
review-external-context                →  external-context.reviewed.json  (optional human check)
        ↓
decompose-agent-transcript-into-transcript-segments and every later tier read both files from tmp_dir
```

It runs after acquisition and before decomposition. It is **best-effort**: a session with no ticket or no reachable tracker still produces a valid (smaller) bundle, and the pipeline runs fine if the skill is skipped entirely.

## The context bundle

`external-context.json` lands in the same `tmp_dir` as `transcript.json`. It has three optional blocks — `ticket`, `pull_request`, `user_context` — plus `unresolved` (sources that were expected but not found) and `notes`. Every populated block records a `confidence` and a `how_found`, so the inference can be audited rather than trusted blindly. See `SKILL.md` for the full shape.

## Design decisions

- **Gather once, transcript-wide.** One up-front pull beats every analyzer re-deriving context per Segment. The narrow, per-Segment counterpart is `pull-together-goal-context` in tier 4 — it reaches out only when a specific Segment's Goal is still unclear.
- **Best-effort, with honest gaps.** Missing sources are recorded in `unresolved`, never fabricated. A confident-but-wrong ticket would poison every downstream analyzer.
- **Provenance over trust.** `confidence` + `how_found` on every block make the bundle reviewable — which is the whole point of the sibling `review-external-context`.
- **The source set grows.** Ticket + PR + light user context is the starting point, not the ceiling. New resolvers get added here as the systems become reachable.
- **Redact on the way in.** This is a genuine ingress point — ticket and PR bodies arrive un-redacted — so they go through the bundled `redaction.py` before they touch disk, exactly like the transcript itself. Secret-redaction runs once, here at acquire time; downstream tiers trust the redacted artifacts and never re-redact.
