# `claude-code-to-open-transcript`

The deterministic CC → OpenTranscripts transformation. Single source of truth for the mapping between Claude Code's JSONL shape and the OpenTranscripts `Transcript` document.

## How it plugs in

Upstream: `get-one-claude-code-transcript` (the orchestrator that drives this skill end-to-end). Also callable directly when you already have a JSONL path.

Downstream: nothing. The output of this skill is what tier 2 consumes.

The canonical mapping doc is [`references/open-transcripts/mappings/claude-code.md`](../../../../references/open-transcripts/mappings/claude-code.md). When CC's format changes, that doc gets updated **first** and this skill follows.

## Design decisions

- **One mapping, one skill.** Putting the CC→OT transformation in its own skill keeps `get-one-claude-code-transcript` thin and testable. The mapping has a single owner.
- **Deterministic only.** No LLM calls. If the mapping is ambiguous, that's a doc bug, not a runtime fallback. Fix the doc.
- **Redact during transform, not after.** Secrets never make it past pass 1. Downstream skills can trust the output is clean.
- **Subagent linkage uses the canonical chain.** The four CC fields (`tool_use.id`, `tool_result.tool_use_id`, `toolUseResult.agentId`, subagent filename `agentId`) form a deterministic chain. We do not guess from timestamps or proximity.
- **Output is one JSON document.** Subagents embed under `subagents[]` rather than living in sibling files. Self-contained bundles are easier to ship to downstream tools, attach to bug reports, and round-trip through tooling.
