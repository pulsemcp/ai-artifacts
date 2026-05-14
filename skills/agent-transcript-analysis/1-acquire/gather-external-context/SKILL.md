---
name: gather-external-context
description: >
  For a given transcript, gather the external context a reviewer would want
  before judging the session: the ticket the work traces back to (e.g. from
  Jira), the pull request it landed in (e.g. from GitHub), and background on
  the user's role, team, and project. Reads transcript.json from
  get-claude-code-transcript-from-local, infers what to look up from the session's
  cwd / git remote / branch / prompts, pulls it from whatever systems are
  reachable, and consolidates everything into one external-context.json that
  travels with the transcript through every later tier. Use after
  get-claude-code-transcript-from-local and before decompose-agent-transcript-into-transcript-segments.
  Best-effort: missing sources are recorded, never fatal. The set of sources
  is expected to grow over time.
user-invocable: true
---

# Gather external context

`transcript.json` captures **what the agent did**. It rarely captures **why** — the ticket that motivated the work, the PR it became, the fact that the user is a backend engineer three weeks into a migration. Without that, every downstream analyzer is guessing at the Goal.

This skill closes that gap. Once per transcript, it pulls the surrounding context from the systems that hold it and consolidates it into a single `external-context.json` that rides in `tmp_dir` alongside `transcript.json` for tiers 2-4 to read.

It is **best-effort**. No Jira integration, no associated PR, no org directory — none of that is a failure. The skill records what it could not find and moves on; the pipeline runs fine without `external-context.json`.

## Inputs

- `tmp_dir` (required): a transcript tmp_dir from `get-claude-code-transcript-from-local`, containing `transcript.json`.
- Context sources (optional, environment-dependent): a Jira MCP server or API token, a GitHub MCP server or the `gh` CLI, an org directory that can resolve a user to a role / team. The skill uses whatever is reachable and skips the rest.

## Output

One file written into `tmp_dir`:

- **`external-context.json`** — the consolidated context bundle:

  ```json
  {
    "schema_version": "0.1",
    "transcript_id": "...",
    "gathered_at": "<iso8601>",
    "ticket": {
      "source": "jira", "id": "PROJ-1234", "url": "...", "title": "...",
      "description": "...", "status": "...",
      "confidence": "high|medium|low",
      "how_found": "<which transcript signal pointed here>"
    },
    "pull_request": {
      "source": "github", "repo": "...", "number": 8, "url": "...",
      "title": "...", "state": "merged|open|closed", "diff_summary": "...",
      "confidence": "...", "how_found": "..."
    },
    "user_context": {
      "role": "...", "team": "...", "project": "...", "tenure": "...",
      "confidence": "...", "how_found": "..."
    },
    "unresolved": ["<a source expected but not found, with why>"],
    "notes": "<free-text caveats for the reviewer and downstream analyzers>"
  }
  ```

  Every block is optional — a session with no ticket omits `ticket` and may add an `unresolved` entry. Every populated block carries `confidence` and `how_found` so a human (and `review-external-context`) can audit the inference.

## Sequencing checklist

- [ ] Confirm `tmp_dir` contains `transcript.json`; if not, run `get-claude-code-transcript-from-local` first
- [ ] Infer lookup keys from the transcript: git remote + branch, branch-name ticket prefixes, ticket ids / PR / issue URLs mentioned in messages, the repo and project slug
- [ ] **Ticket** — if a ticket id or strong branch-prefix signal exists, fetch it from the tracker. Record `id`, `url`, `title`, `description`, `status`, plus `confidence` and `how_found`
- [ ] **Pull request** — resolve the PR the session led to (a PR URL in the transcript, or the branch matched against recent PRs on the repo). Record metadata and a short `diff_summary` — do not inline the full diff
- [ ] **User context** — gather what's reasonably available about the user's role / team / project. This source set is intentionally thin today; extend this step (and the schema) as new resolvers appear rather than forcing a guess
- [ ] Consolidate into `external-context.json`. Anything expected-but-missing goes in `unresolved` with a reason — never fabricate a ticket or PR to fill a slot
- [ ] Redact every fetched string through the bundled `redaction.py` before writing — ticket bodies and PR descriptions routinely carry secrets. This is a genuine ingress point, so redaction runs here; downstream tiers trust the redacted artifacts and never re-redact
- [ ] Point the user at `review-external-context` so low-confidence inferences get a human check before tier 2

## Out of scope

- Acquiring the transcript itself — that's `get-claude-code-transcript-from-local`.
- Correcting the gathered context — that's `review-external-context`.
- Per-Segment context lookups during analysis — that's `pull-together-goal-context` in tier 3, which does narrow, on-demand pulls once a specific Segment's Goal is unclear. This skill does the one-time, transcript-wide gather up front.
- Any judgment about whether the session went well — that's tiers 3-4.

## Notes

- **Best-effort, never blocking.** The pipeline runs without `external-context.json`; this skill only ever *adds* signal.
- **Confidence and provenance are mandatory.** A wrong-but-confident ticket is worse than an honest `unresolved` entry — both the review UI and downstream analyzers lean on `confidence` and `how_found`.
- **The source set is meant to grow.** Today: ticket + PR + light user context. As new systems become reachable (design docs, incident records, org chart), add a step here and a block to the schema. Treat "we don't know how to get X yet" as a tracked gap, not a reason to drop X silently.
- **Consolidate, don't analyze.** This skill structures context; it draws no conclusions about the session. That's tiers 3-4.
