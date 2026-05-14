# Maintaining `agent-transcript-analysis`

Notes for anyone — agent or human — editing skills in this directory.

## Keep the skill-flow diagram current

`README.md` carries a **`## Skill flow` mermaid diagram**: every skill in the
plugin, as a node, with the data that flows between them on the edges. It is the
canonical at-a-glance map of the pipeline, and people read it to understand how
the pieces fit.

**Whenever you add, remove, rename, or re-tier a skill, update that mermaid
diagram in the same change.** A skill present in `skills/skills.json` but absent
from the diagram (or the reverse) is a bug — treat it like a failing test.

Skill membership is duplicated in a few places. When skills change, keep all of
them in sync:

- `README.md` — the `## Skill flow` mermaid diagram **and** the folder-tree block
  under `## How the skills interplay`
- `skills/skills.json` — the flat catalog AIR resolves; source of truth for each
  skill's `name` and `description`
- `plugins/plugins.json` — the `agent-transcript-analysis` plugin's `skills` array
- the tier `README.md` files (`1-acquire/`, `2-decompose/`, …) — each lists the
  skills in its own tier

## Documentation conventions

Two rules apply to every `SKILL.md` and `README.md` in this tree:

- **Reference other skills and reference docs by their registered `name`, in
  backticks — never by filesystem path.** At runtime a skill runs from a deployed
  copy under `.claude/skills/<name>/`, so `../../../` links break. Skill names
  live in `skills/skills.json`; reference names in `references/references.json`.
- **Flag skill-improvement opportunities; never instruct editing skill files.**
  The skill files visible at runtime are a deployed copy, not the source of
  truth. A skill that notices another skill could be better should *surface the
  opportunity for the user* — not emit a ready-to-apply edit or point at a path.
