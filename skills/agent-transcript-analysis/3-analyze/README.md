# Tier 3: `3-analyze`

Per-domain analysis layer. Three sibling buckets, each producing one of the three recommendation buckets in the final report.

## Buckets in this tier

- `analyze-prompts/` — human-prompting recommendations (`analyze-user-prompt`, `pull-together-goal-context`)
- `analyze-skills/` — Skill recommendations (trigger / action / gaps)
- `analyze-mcp/` — MCP recommendations (trigger / action / gaps)

Each bucket has its own README explaining the trigger / action / gaps split (or, for prompts, the analyzer / helper split).

## How this tier plugs into the rest

Driven by Tier 2 (`2-orchestrate/analyze-agent-transcript`), once per segment. Each analyzer emits a structured finding that the orchestrator aggregates.

Analyzers in this tier are not meant to be invoked directly — they assume a goal-aligned segment and the manifest fields the orchestrator provides.

## Design decisions

- **One bucket per recommendation type in the final report.** The three buckets in this tier map 1:1 to the three buckets in the orchestrator's output. Clean separation keeps recommendations from drifting between categories.
- **Symmetric trigger / action / gaps split** inside `analyze-skills/` and `analyze-mcp/`. The same precision benefit applies to both — knowing which lever to pull (description, body, or new artifact) matters as much for MCP as it does for Skills.
- **No cross-bucket recommendations.** A prompt analyzer never recommends a Skill, and a Skill analyzer never recommends a prompt rewrite. Buckets stay clean; the orchestrator combines them.
