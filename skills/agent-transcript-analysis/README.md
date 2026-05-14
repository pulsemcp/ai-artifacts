# `agent-transcript-analysis` skills

The full set of Skills bundled by the `agent-transcript-analysis` plugin. Used when someone wants a Claude Code session (or many of them) analyzed for what could have gone better — and what change to Skills / MCP servers / prompting habits would prevent it next time.

## Two layers: Transcript and Transcript Segment

Everything in this plugin operates on two layered data primitives, both defined by the `open-transcripts` reference set:

- **`Transcript`** — the OpenTranscripts wrapper. One JSON document per session, with `events[]`, recursive `subagents[]`, and metadata. Vendor-neutral. Tier 1 produces it from Claude Code's JSONL (see the `open-transcripts-claude-code-mapping` reference).
- **`TranscriptSegment`** — the analysis tree built over a Transcript. Trigger (kind × source), Goal, Outcome, children. Tier 2 produces it from a Transcript; tiers 3+ consume only Segments.

The split means: a new vendor (Codex, Pi, Cursor) only needs a new mapping doc + transformation skill; the Segment tree and every analyzer downstream work unchanged.

## How the skills interplay

The folder layout is numbered to mirror the orchestration tiers — `tree` output reads top-to-bottom in execution order:

```
agent-transcript-analysis/
  1-acquire/              # tier 1: a session id → one transcript.json + its external context
    find-all-claude-code-transcripts-on-local/
    get-claude-code-transcript-from-local/      # session id → deterministic CC → OpenTranscripts mapping
    gather-external-context/                    # pull the ticket / PR / user context into external-context.json
    review-external-context/                    # optional human-review UI for the gathered context
  2-decompose/            # tier 2: produce the Segment tree (segments.json + flamegraph)
    decompose-agent-transcript-into-transcript-segments/
  3-orchestrate/          # tier 3: drive fan-out and aggregation (single skill)
    analyze-agent-transcript/
  4-analyze/              # tier 4: per-Segment analyzers (4 buckets) + cross-transcript
    analyze-outcomes/         { analyze-failure-hypothesis, analyze-segment-efficiency }
    analyze-prompts/          { analyze-user-prompt, analyze-prompt-ambition,
                                pull-together-goal-context }
    analyze-skills/           { trigger, action, gaps }
    analyze-mcp/              { trigger, action, gaps }
    analyze-cross-transcript/ { analyze-cross-transcript-patterns }
```

Tier 1 → 2 → 3 → 4. The `analyze-cross-transcript` bucket in tier 4 runs separately from the per-Segment buckets, consuming the consolidated outputs of many Tier 3 reports at once.

Numbered prefixes only land on grouping folders, never on Skill folders themselves — the Skills spec requires a Skill's folder name to match its `name`.

## Skill flow

How a transcript moves through the skills — every node is a registered Skill with a one-line description; edge labels are what flows between them.

```mermaid
flowchart TD
    subgraph T1["Tier 1 · acquire"]
        FA["<b>find-all-claude-code-transcripts-on-local</b><br/>list every local session; browser picker UI"]
        GET["<b>get-claude-code-transcript-from-local</b><br/>session id to one transcript.json; deterministic CC to OpenTranscripts mapping, subagents embedded"]
        GEC["<b>gather-external-context</b><br/>pull the ticket, PR, and user context around the session into external-context.json"]
        REC["<b>review-external-context</b><br/>optional human-review UI; writes external-context.reviewed.json"]
    end

    subgraph T2["Tier 2 · decompose"]
        DEC["<b>decompose-agent-transcript-into-transcript-segments</b><br/>transcript.json to recursive Segment tree + flamegraph"]
        REV["<b>review-transcript-segments</b><br/>optional human-review UI; writes segments.reviewed.json"]
        LEARN["<b>learn-from-segment-corrections</b><br/>cluster human corrections; flag decomposer heuristic fixes"]
    end

    subgraph T3["Tier 3 · orchestrate"]
        ORCH["<b>analyze-agent-transcript</b><br/>entry point; drives tiers 2 + 4 into one consolidated report"]
    end

    subgraph T4["Tier 4 · analyze"]
        subgraph T4O["analyze-outcomes"]
            FH["<b>analyze-failure-hypothesis</b><br/>improvement hypothesis per Failure / retro-Failure"]
            SE["<b>analyze-segment-efficiency</b><br/>flag wasteful branches + model-tier mismatch"]
        end
        subgraph T4P["analyze-prompts"]
            UP["<b>analyze-user-prompt</b><br/>classify the prompt; judge whether the Goal closed the loop"]
            PA["<b>analyze-prompt-ambition</b><br/>flag under-scoped / should-be-deterministic prompts"]
            GC["<b>pull-together-goal-context</b><br/>pull git + external context when the Goal isn't self-evident"]
        end
        subgraph T4S["analyze-skills"]
            STP["<b>analyze-skill-trigger-performance</b><br/>Skill false positives / false negatives"]
            SAP["<b>analyze-skill-action-performance</b><br/>Skills that ran: helpfulness, token cost, closed-loop"]
            SG["<b>analyze-skill-gaps</b><br/>flag moments a missing Skill would have helped"]
        end
        subgraph T4M["analyze-mcp"]
            MTP["<b>analyze-mcp-trigger-performance</b><br/>MCP tool false positives / false negatives"]
            MAP["<b>analyze-mcp-action-performance</b><br/>MCP calls that ran: response shape, token cost, closed-loop"]
            MG["<b>analyze-mcp-gaps</b><br/>flag missing MCP servers / tools"]
        end
        subgraph T4X["analyze-cross-transcript"]
            XT["<b>analyze-cross-transcript-patterns</b><br/>many consolidated reports to patterns no single transcript reveals"]
        end
    end

    FA -->|pick session id| GET
    GET -->|transcript.json| GEC
    GEC -.->|optional checkpoint| REC
    GEC -->|transcript.json + external-context.json| ORCH
    ORCH -->|invokes| DEC
    DEC -->|segments.json| ORCH
    DEC -.->|optional checkpoint| REV
    REV -->|correction logs| LEARN
    LEARN -.->|flags heuristic fixes| DEC
    ORCH -->|fans out per Segment| T4O
    ORCH --> T4P
    ORCH --> T4S
    ORCH --> T4M
    T4O -->|findings| ORCH
    T4P --> ORCH
    T4S --> ORCH
    T4M --> ORCH
    ORCH -->|consolidated report, one per transcript| XT
```

## Design decisions

- **Two data primitives, one downstream contract.** `Transcript` (tier 1 output) carries vendor-coupled detail; `TranscriptSegment` (tier 2 output) is the analysis tree. The downstream tiers read only `segments.json` and dereference event ids back into `transcript.json` for evidence. If either is wrong, fix the producing tier and re-run — don't patch around it downstream.
- **OpenTranscripts is the cross-vendor contract.** Tier 1's output shape is governed by the `open-transcripts` reference set, not by any one vendor's JSONL. When CC changes its format, only the mapping doc + the transformation skill change.
- **External context is gathered once, up front.** A transcript records *what* the agent did; it rarely records *why*. Tier 1's `gather-external-context` pulls the ticket, the PR, and light user context into one `external-context.json` that rides alongside `transcript.json` through every later tier — so no analyzer has to re-derive the Goal's backdrop. It is best-effort (missing sources are recorded, never fatal) and has `review-external-context` as its optional human checkpoint, mirroring tier 2's `review-transcript-segments`.
- **Numbered tiers, not flat buckets.** The execution layers (acquire → decompose → orchestrate → analyze) are visible in the directory tree.
- **Grouping folders are never Skills.** `1-acquire/`, `2-decompose/`, `3-orchestrate/`, `4-analyze/`, and the per-domain buckets under tier 4 contain no `SKILL.md` of their own. That keeps the spec's "everything under a skill folder belongs to that skill" model intact.
- **Four per-Segment tier-4 buckets, three output buckets.** `analyze-outcomes/` is Segment-shaped (failure hypotheses, efficiency); its findings *route* into the three artifact buckets (Prompting / Skills / MCP) via `recommendation_route`. The final report keeps a clean three-bucket structure.
- **Cross-transcript is tier-4 labeling, not its own tier.** Patterns visible only at scale (recurring prompts, hindsight-as-foresight Segment shapes, time-spend trends) need many reports as input — but they are still *labeling*, the same kind of work as the per-Segment buckets, just at a wider scope. So `analyze-cross-transcript/` lives in tier 4. It runs separately from the per-transcript orchestrator, which would only muddy both if it drove cross-transcript fan-out too.
- **Folder hierarchy is for humans.** AIR resolves Skills via `skills.json`, which is flat. The nested folders exist so contributors can see the orchestration shape at a glance.
- **Philosophy docs are the tie-breaker.** Every analyzer cross-checks its recommendation against the `philosophy-on-skills` and `philosophy-on-mcp` references so the output stays consistent with team stance, not just per-Segment heuristics.
- **Local-first.** Nothing in this plugin uploads or phones home; all analysis happens against the local tmp folder.
