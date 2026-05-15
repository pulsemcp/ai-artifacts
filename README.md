# AI Artifacts

An AIR-shaped catalog of agent artifacts (skills, references, plugins, hooks) for Claude Code and other AIR-aware agents.

The repo is a single [pulsemcp/AIR](https://github.com/pulsemcp/air) catalog: an AIR CLI pointed at `air.json` should resolve everything in this repo under `local` scope.

```
.
├── air.json                       # AIR root config — points at the per-type index files
├── skills/
│   ├── skills.json                # AIR skills index (flat — every skill listed by id)
│   └── <plugin-id>/               # plugin grouping — numbered phase folders inside
│       ├── 1-<phase>/              # grouping folders are non-Skills (no SKILL.md)
│       │   └── <skill-id>/SKILL.md
│       ├── 2-<phase>/...
│       └── N-<phase>/...
├── references/
│   ├── references.json            # AIR references index
│   ├── philosophy-on-skills.md
│   ├── philosophy-on-mcp.md
│   └── open-transcripts/          # vendor-neutral data model for coding-agent transcripts
│       ├── README.md
│       ├── schemas/               # Transcript wrapper, events, Transcript Segment
│       ├── mappings/              # e.g. Claude Code JSONL → Transcript
│       └── examples/              # minimal Transcript / Segment instances
├── plugins/
│   └── plugins.json               # AIR plugin index
└── hooks/
    ├── hooks.json                 # AIR hooks index
    └── agent-transcript-capture/  # capture-side hook (formerly `trace-capture`)
```

Schema references for each index file:

- `skills.json` → [`skills.schema.json`](https://github.com/pulsemcp/air/blob/main/schemas/skills.schema.json)
- `references.json` → [`references.schema.json`](https://github.com/pulsemcp/air/blob/main/schemas/references.schema.json)
- `plugins.json` → [`plugins.schema.json`](https://github.com/pulsemcp/air/blob/main/schemas/plugins.schema.json)
- `hooks.json` → [`hooks.schema.json`](https://github.com/pulsemcp/air/blob/main/schemas/hooks.schema.json)
- `air.json` → [`air.schema.json`](https://github.com/pulsemcp/air/blob/main/schemas/air.schema.json)

## Plugins

### `agent-transcript-analysis`

> Status: scaffold. The skills capture the intended flow but are not implemented yet.

A plugin for analyzing your own (and your team's) Claude Code session transcripts and producing **actionable advice** on how each transcript segment could have gone better.

Every analysis pass over a transcript segment ends with concrete, actionable recommendations in three buckets:

1. **Human prompting** — what should the user have said differently? Was it ambiguous, missing context, asking for the wrong thing?
2. **Skills** — what Skill should be **created**, **modified**, or **deleted** to make the next session like this go better?
3. **MCP servers** — what MCP server / tool should be **created**, **modified**, or **deleted** to close gaps the agent couldn't close on its own?

If a segment produces no recommendation in any bucket, it didn't need analysis — say so and move on. The output is only useful when it's specific enough to open a PR or rewrite a prompt from.

The team's "when to create or modify a Skill" heuristics — agent makes a mistake despite a correct prompt; the same long prompt is being written twice; a segment of work is repeated within or across sessions; the agent spins its wheels; the user can't write a closed-loop prompt due to foreseeable gaps — are the *signals* the analyzers look for. The recommendations above are the *output* those signals are translated into.

For the team's evolving stance on what makes a good Skill or MCP server, see:

- [`references/philosophy-on-skills.md`](references/philosophy-on-skills.md)
- [`references/philosophy-on-mcp.md`](references/philosophy-on-mcp.md)

Every analysis skill should consult these before recommending a create/modify/delete.

#### Workflow

The pipeline is built around the **Transcript Segment** — a recursive primitive (one Goal, one Outcome, optional Prompt, sub-Segments). See [`references/transcript-segment.md`](references/transcript-segment.md). Phase 2 produces the Segment tree; everything downstream reads it.

```
┌────────────────────────────────────┐
│ 1: find-all-claude-code-transcripts-on-local│  Pick a session to dig into
└────────────────┬───────────────────┘
                 │ session id
                 ▼
┌────────────────────────────────────┐
│ 1: get-claude-code-transcript-from-local      │  Pull main + subagent transcripts
└────────────────┬───────────────────┘  into a single tmp folder
                 │ tmp dir
                 ▼
┌────────────────────────────────────┐
│ 2: decompose-into-transcript-      │  Walk JSONL once; emit segments.json
│    segments                        │  (Segment tree) + flamegraph.html
└────────────────┬───────────────────┘
                 │ segments.json
                 ▼
┌────────────────────────────────────┐
│ 3: analyze-agent-transcript        │  Orchestrator. For each Segment runs
└────────────────┬───────────────────┘  the per-Segment analyzers below,
                 │                       then stops at this transcript's findings.
   ┌───────────┬─┴─┬────────────┬─────────────────┐
   ▼           ▼   ▼            ▼                 ▼
┌──────────┐ ┌────────┐ ┌──────────────┐ ┌──────────────┐
│ outcomes │ │prompts │ │ skills       │ │ mcp          │
│ failure  │ │user-pr.│ │ trigger      │ │ trigger      │
│ efficien.│ │ambition│ │ action       │ │ action       │
└────┬─────┘ │goal-ctx│ │ gaps         │ │ gaps         │
     │       └───┬────┘ └──────┬───────┘ └──────┬───────┘
     └───────────┴──────────┬──┴────────────────┘
                            ▼
                findings.{outcomes,prompts,skills,mcp}.json
                  — one set per transcript. Phases 1-3
                  repeat per transcript; findings accumulate.

   ── once the batch is complete ──────────────────────────

           ┌────────────────────────────────────┐
           │ 3: analyze-cross-transcript-       │   Optional. Runs once over all
           │    patterns                        │   transcripts' findings →
           └────────────────┬───────────────────┘   findings.cross-transcript.json
                            │
                            ▼
           ┌────────────────────────────────────┐
           │ 4: synthesize-agent-transcript-analysis-report               │   Runs once over the whole batch's
           └────────────────┬───────────────────┘   findings → one final report:
                            │                        findings.report.json + report.md
                            ▼
                One batch-final report:
                  • Prompting changes
                  • Skill: create/modify/delete
                  • MCP:   create/modify/delete
```

#### Skills bundled by this plugin

| Phase | Skill | Role |
|---|---|---|
| 1 — acquire | [`find-all-claude-code-transcripts-on-local`](skills/agent-transcript-analysis/1-acquire/find-all-claude-code-transcripts-on-local/SKILL.md) | Lists sessions from `~/.claude/projects` and spawns a local UI to pick one. |
| 1 — acquire | [`get-claude-code-transcript-from-local`](skills/agent-transcript-analysis/1-acquire/get-claude-code-transcript-from-local/SKILL.md) | Given a session id, gathers the main transcript **plus any subagent transcripts** into a single tmp folder. |
| 2 — decompose | [`decompose-agent-transcript-into-transcript-segments`](skills/agent-transcript-analysis/2-decompose/decompose-agent-transcript-into-transcript-segments/SKILL.md) | Walks the JSONL once and produces the recursive **Transcript Segment** tree (`segments.json`) plus an annotated `flamegraph.html`. Sole producer of the Segment primitive. |
| 3 — analyze | [`analyze-agent-transcript`](skills/agent-transcript-analysis/3-analyze/analyze-agent-transcript/SKILL.md) | Orchestrator and entry point of the analyze phase. Picks up the Segment tree from phase 2, runs the per-Segment analyzers, and writes that transcript's findings — then stops. Runs per transcript; produces no report. |
| 3 — analyze (outcomes) | [`analyze-agent-transcript-failure-hypothesis`](skills/agent-transcript-analysis/3-analyze/analyze-outcomes/analyze-agent-transcript-failure-hypothesis/SKILL.md) | For every Failure Outcome (and retro-Failure surfaced by a Correction Prompt), produces an improvement hypothesis. |
| 3 — analyze (outcomes) | [`analyze-agent-transcript-segment-efficiency`](skills/agent-transcript-analysis/3-analyze/analyze-outcomes/analyze-agent-transcript-segment-efficiency/SKILL.md) | Wall-clock / token spend vs human counterfactual. Flags wasteful branches and model-phase mismatches — including on Successes. |
| 3 — analyze (prompts) | [`analyze-agent-transcript-user-prompt`](skills/agent-transcript-analysis/3-analyze/analyze-prompts/analyze-agent-transcript-user-prompt/SKILL.md) | Per-Prompt: question vs delegation, Goal, closed-loop. Feeds the "human prompting" recommendation bucket. |
| 3 — analyze (prompts) | [`analyze-agent-transcript-prompt-ambition`](skills/agent-transcript-analysis/3-analyze/analyze-prompts/analyze-agent-transcript-prompt-ambition/SKILL.md) | Per-Initial-Prompt: was it scoped right, should a deterministic trigger have fired it. |
| 3 — analyze (prompts) | [`pull-together-agent-transcript-goal-context`](skills/agent-transcript-analysis/3-analyze/analyze-prompts/pull-together-agent-transcript-goal-context/SKILL.md) | Reaches into git repos / external systems when a Prompt's Goal isn't self-evident. Helper for `analyze-agent-transcript-user-prompt`. |
| 3 — analyze (skills) | [`analyze-agent-transcript-skill-trigger-performance`](skills/agent-transcript-analysis/3-analyze/analyze-skills/analyze-agent-transcript-skill-trigger-performance/SKILL.md) | Skills that triggered when they shouldn't have, or didn't trigger when they should have. |
| 3 — analyze (skills) | [`analyze-agent-transcript-skill-action-performance`](skills/agent-transcript-analysis/3-analyze/analyze-skills/analyze-agent-transcript-skill-action-performance/SKILL.md) | Did the Skills that ran actually help? Cost vs benefit. |
| 3 — analyze (skills) | [`analyze-agent-transcript-skill-gaps`](skills/agent-transcript-analysis/3-analyze/analyze-skills/analyze-agent-transcript-skill-gaps/SKILL.md) | Skills that *should have existed* — missing capabilities surfaced by this Segment. |
| 3 — analyze (mcp) | [`analyze-agent-transcript-mcp-trigger-performance`](skills/agent-transcript-analysis/3-analyze/analyze-mcp/analyze-agent-transcript-mcp-trigger-performance/SKILL.md) | Same as the Skill version, but for MCP servers / tools. |
| 3 — analyze (mcp) | [`analyze-agent-transcript-mcp-action-performance`](skills/agent-transcript-analysis/3-analyze/analyze-mcp/analyze-agent-transcript-mcp-action-performance/SKILL.md) | Same as the Skill version, but for MCP servers / tools. |
| 3 — analyze (mcp) | [`analyze-agent-transcript-mcp-gaps`](skills/agent-transcript-analysis/3-analyze/analyze-mcp/analyze-agent-transcript-mcp-gaps/SKILL.md) | Same as the Skill version, but for MCP servers / tools. |
| 3 — analyze (cross-transcript) | [`analyze-cross-agent-transcript-patterns`](skills/agent-transcript-analysis/3-analyze/analyze-cross-transcript/analyze-cross-agent-transcript-patterns/SKILL.md) | Runs once over many transcripts' findings sets — last in phase 3, an optional pre-report step. Surfaces hindsight-as-foresight Segment patterns, recurring user prompts, deduped Skill/MCP gaps, and time-spend trends. |

#### Privacy

This plugin is **local-first**. Transcripts live in `~/.claude/projects/`; analysis happens on your machine; the UI runs on `localhost`. Borrowing from the prior work in [`pulsemcp/agentic-engineering-infra`](https://github.com/pulsemcp/agentic-engineering-infra) (archived):

- Server-side redaction of secrets (API keys, AWS creds, JWTs, private keys, connection strings, GitHub tokens, etc.) before any content reaches the browser.
- No upload, no submit, no telemetry. The tmp folder produced by `get-claude-code-transcript-from-local` is yours; delete it when you're done.
- All HTML/JS served from a single static file; no CDN imports, no build step.

#### Prior art

The `transcript-export` and `transcript-analysis` tools in the archived [agentic-engineering-infra](https://github.com/pulsemcp/agentic-engineering-infra) repo are the starting point for the UI and redaction logic. This plugin reorganizes that work around an analysis *workflow* rather than a generic browser, so each step has a Skill that an agent (or you) can invoke.

### `agent-transcript-capture`

A hook-only plugin that bundles a single Stop-event hook to capture complete agent session archives (transcripts, subagents, tool results) to cloud storage on task completion. The companion to `agent-transcript-analysis` — capture upstream, analyze downstream.

This hook was previously named `trace-capture`. The directory and AIR ids have been renamed to `agent-transcript-capture`, but some runtime identifiers (env var `TRACE_CAPTURE_HOME`, manifest dir `~/.trace-capture/`, and a few log/error strings) still use the old name pending a follow-up cleanup.

See [`hooks/agent-transcript-capture/README.md`](hooks/agent-transcript-capture/README.md) for configuration and installation.

## Hooks

The hooks index also contains stand-alone hook entries that can be wired up independently of any plugin. Currently:

- [`agent-transcript-capture`](hooks/agent-transcript-capture/) — bundled by the `agent-transcript-capture` plugin above.
