# `agent-transcript-analysis` skills

The full set of Skills bundled by the `agent-transcript-analysis` plugin. Used when someone wants a Claude Code session analyzed for what could have gone better — and what change to Skills / MCP servers / prompting habits would prevent it next time.

## How the skills interplay

The folder layout is numbered to mirror the orchestration tiers — `tree` output reads top-to-bottom in execution order:

```
agent-transcript-analysis/
  1-acquire/         # tier 1: pull a session + its subagents into one tmp folder
    find-all-claude-code-transcripts/
    get-one-claude-code-transcript/
  2-orchestrate/     # tier 2: drive segmentation and fan-out (single skill)
    analyze-agent-transcript/
  3-analyze/         # tier 3: per-domain analyzers, one bucket per recommendation type
    analyze-prompts/   { analyze-user-prompt, pull-together-goal-context }
    analyze-skills/    { trigger, action, gaps }
    analyze-mcp/       { trigger, action, gaps }
```

Tier 1 → Tier 2 → Tier 3. The numbered prefixes only land on grouping folders, never on Skill folders themselves — the spec requires a Skill's folder name to match its `name`.

## Design decisions

- **Numbered tiers, not flat buckets.** The execution layers (acquire → orchestrate → analyze) are now visible in the directory tree. Cheaper than a workflow diagram and harder to drift out of sync with reality.
- **Grouping folders are never Skills.** `1-acquire/`, `2-orchestrate/`, `3-analyze/`, and the per-domain buckets under tier 3 contain no `SKILL.md` of their own. That keeps the spec's "everything under a skill folder belongs to that skill" model intact.
- **Buckets, not a monolith.** Splitting analyzers by trigger / action / gaps makes each one focused and auditable, at the cost of more skill files. We accept the duplication.
- **Folder hierarchy is for humans.** AIR resolves Skills via `skills.json`, which is flat. The nested folders exist so contributors can see the orchestration shape at a glance.
- **Philosophy docs are the tie-breaker.** Every analyzer cross-checks its recommendation against `references/philosophy-on-{skills,mcp}.md` so the output stays consistent with team stance, not just per-segment heuristics.
- **Local-first.** Nothing in this plugin uploads or phones home; all analysis happens against the local tmp folder.
