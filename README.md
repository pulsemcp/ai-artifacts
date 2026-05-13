# AI Artifacts

An AIR-shaped catalog of agent artifacts (skills, references, plugins, hooks) for Claude Code and other AIR-aware agents.

The repo is a single [pulsemcp/AIR](https://github.com/pulsemcp/air) catalog: an AIR CLI pointed at `air.json` should resolve everything in this repo under `local` scope.

```
.
├── air.json                       # AIR root config — points at the per-type index files
├── skills/
│   ├── skills.json                # AIR skills index (flat — every skill listed by id)
│   └── <plugin-id>/               # plugin grouping — numbered tier folders inside
│       ├── 1-<tier>/              # grouping folders are non-Skills (no SKILL.md)
│       │   └── <skill-id>/SKILL.md
│       ├── 2-<tier>/...
│       └── 3-<tier>/...
├── references/
│   ├── references.json            # AIR references index
│   ├── philosophy-on-skills.md
│   └── philosophy-on-mcp.md
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

```
┌────────────────────────────────────┐
│ find-all-claude-code-transcripts   │  Pick a session to dig into
└────────────────┬───────────────────┘
                 │ session id
                 ▼
┌────────────────────────────────────┐
│ get-one-claude-code-transcript     │  Pull main + subagent transcripts
└────────────────┬───────────────────┘  into a single tmp folder
                 │ tmp dir
                 ▼
┌────────────────────────────────────┐
│ analyze-agent-transcript           │  Orchestrator. Splits transcript into
└────────────────┬───────────────────┘  goal-aligned segments and runs the
                 │                       per-segment analyses below, then
                 │                       aggregates their recommendations.
       ┌─────────┴─────────┐
       ▼                   ▼
┌─────────────────┐  ┌─────────────────────────────┐
│ analyze-user-   │  │ analyze-skill-trigger-perf. │
│ prompt          │  │ analyze-skill-action-perf.  │
└────────┬────────┘  │ analyze-skill-gaps          │
         │           │ analyze-mcp-trigger-perf.   │
         ▼           │ analyze-mcp-action-perf.    │
┌─────────────────┐  │ analyze-mcp-gaps            │
│ pull-together-  │  └─────────────────────────────┘
│ goal-context    │            │
└─────────────────┘            ▼
                       Recommendations:
                         • Prompting changes
                         • Skill: create/modify/delete
                         • MCP:   create/modify/delete
```

#### Skills bundled by this plugin

| Skill | Role |
|---|---|
| Tier | Skill | Role |
|---|---|---|
| 1 — acquire | [`find-all-claude-code-transcripts`](skills/agent-transcript-analysis/1-acquire/find-all-claude-code-transcripts/SKILL.md) | Lists sessions from `~/.claude/projects` and spawns a local UI to pick one. |
| 1 — acquire | [`get-one-claude-code-transcript`](skills/agent-transcript-analysis/1-acquire/get-one-claude-code-transcript/SKILL.md) | Given a session id, gathers the main transcript **plus any subagent transcripts** into a single tmp folder ready for analysis. |
| 2 — orchestrate | [`analyze-agent-transcript`](skills/agent-transcript-analysis/2-orchestrate/analyze-agent-transcript/SKILL.md) | Orchestrator. Breaks the transcript into goal-aligned segments, runs the per-segment analyses, and aggregates recommendations. |
| 3 — analyze (prompts) | [`analyze-user-prompt`](skills/agent-transcript-analysis/3-analyze/analyze-prompts/analyze-user-prompt/SKILL.md) | Per-prompt: question vs delegation, what was the goal, was it closed-loop. Feeds the "human prompting" recommendation bucket. |
| 3 — analyze (prompts) | [`pull-together-goal-context`](skills/agent-transcript-analysis/3-analyze/analyze-prompts/pull-together-goal-context/SKILL.md) | Reaches into git repos / external systems when a prompt's goal isn't self-evident. Helper for `analyze-user-prompt`. |
| 3 — analyze (skills) | [`analyze-skill-trigger-performance`](skills/agent-transcript-analysis/3-analyze/analyze-skills/analyze-skill-trigger-performance/SKILL.md) | Skills that triggered when they shouldn't have, or didn't trigger when they should have. |
| 3 — analyze (skills) | [`analyze-skill-action-performance`](skills/agent-transcript-analysis/3-analyze/analyze-skills/analyze-skill-action-performance/SKILL.md) | Did the Skills that ran actually help? Cost vs benefit. |
| 3 — analyze (skills) | [`analyze-skill-gaps`](skills/agent-transcript-analysis/3-analyze/analyze-skills/analyze-skill-gaps/SKILL.md) | Skills that *should have existed* — missing capabilities surfaced by this segment. |
| 3 — analyze (mcp) | [`analyze-mcp-trigger-performance`](skills/agent-transcript-analysis/3-analyze/analyze-mcp/analyze-mcp-trigger-performance/SKILL.md) | Same as the Skill version, but for MCP servers / tools. |
| 3 — analyze (mcp) | [`analyze-mcp-action-performance`](skills/agent-transcript-analysis/3-analyze/analyze-mcp/analyze-mcp-action-performance/SKILL.md) | Same as the Skill version, but for MCP servers / tools. |
| 3 — analyze (mcp) | [`analyze-mcp-gaps`](skills/agent-transcript-analysis/3-analyze/analyze-mcp/analyze-mcp-gaps/SKILL.md) | Same as the Skill version, but for MCP servers / tools. |

#### Privacy

This plugin is **local-first**. Transcripts live in `~/.claude/projects/`; analysis happens on your machine; the UI runs on `localhost`. Borrowing from the prior work in [`pulsemcp/agentic-engineering-infra`](https://github.com/pulsemcp/agentic-engineering-infra) (archived):

- Server-side redaction of secrets (API keys, AWS creds, JWTs, private keys, connection strings, GitHub tokens, etc.) before any content reaches the browser.
- No upload, no submit, no telemetry. The tmp folder produced by `get-one-claude-code-transcript` is yours; delete it when you're done.
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
