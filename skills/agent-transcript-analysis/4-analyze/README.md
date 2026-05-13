# Tier 4: `4-analyze`

Per-Segment analysis layer. Four sibling buckets, each producing structured findings the orchestrator (Tier 3) aggregates.

## Buckets in this tier

- `analyze-outcomes/` — Segment-shaped findings: failure hypotheses and efficiency. (`analyze-failure-hypothesis`, `analyze-segment-efficiency`)
- `analyze-prompts/` — human-prompting recommendations. (`analyze-user-prompt`, `analyze-prompt-ambition`, helper `pull-together-goal-context`)
- `analyze-skills/` — Skill recommendations. (trigger / action / gaps)
- `analyze-mcp/` — MCP recommendations. (trigger / action / gaps)

Each bucket has its own README explaining how its skills relate.

## How this tier plugs into the rest

Driven by Tier 3 (`3-orchestrate/analyze-agent-transcript`), once per Segment. Each analyzer emits a structured finding the orchestrator aggregates into the final report's three buckets (Prompting / Skills / MCP).

Analyzers in this tier do **not** read raw JSONL — they read Segments from `segments.json` produced by Tier 2. If a Segment field is missing or wrong, fix Tier 2 and re-run; don't patch around it here.

## Design decisions

- **Three artifact-shaped buckets, one Segment-shaped bucket.** Prompts / Skills / MCP correspond to the three final-report buckets. `analyze-outcomes` is different in kind — it asks "did this Segment fail" and "was it efficient" — and routes its findings *into* the three artifact buckets via the gap analyzers.
- **Symmetric trigger / action / gaps split** inside `analyze-skills/` and `analyze-mcp/`. Knowing which lever to pull (description, body, or new artifact) matters as much for MCP as for Skills.
- **No cross-bucket recommendations.** A prompt analyzer never proposes a Skill artifact; a Skill analyzer never rewrites a prompt. The outcomes bucket is the only one that legitimately points at multiple downstream buckets, and it does so via `recommendation_route` rather than by drafting the artifact itself.
- **The Segment is the unit, not the message.** Every analyzer's input is a Segment (plus its neighbors / parent as needed). Never re-walk JSONL.
