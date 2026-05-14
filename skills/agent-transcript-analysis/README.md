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
  2-decompose/            # tier 2: produce the Segment tree (segments.json + flamegraph) + review loop
    decompose-agent-transcript-into-transcript-segments/
    review-transcript-segments/                 # optional human-review UI over the Segment tree
    learn-from-segment-corrections/              # cluster review corrections; flag decomposer fixes
  3-orchestrate/          # tier 3: drive fan-out + hand off to synthesis (single skill)
    analyze-agent-transcript/
  4-analyze/              # tier 4: per-Segment analyzers (4 buckets) + cross-transcript + review loop
    analyze-outcomes/         { analyze-failure-hypothesis, analyze-segment-efficiency }
    analyze-prompts/          { analyze-user-prompt, analyze-prompt-ambition,
                                pull-together-goal-context }
    analyze-skills/           { trigger, action, gaps }
    analyze-mcp/              { trigger, action, gaps }
    analyze-cross-transcript/ { analyze-cross-transcript-patterns }
    review-analysis/                  # human-review UI over any findings.<kind>.json draft
    learn-from-analysis-corrections/  # cluster review corrections; flag tier-4 analyzer fixes
  5-report/               # tier 5: synthesize findings into the recommendation report + review loop
    synthesize-report/                # tier-4 findings → findings.report.json + report.md
    review-report/                    # optional human-review UI over the recommendation slate
    learn-from-report-corrections/    # cluster review corrections; flag synthesize-report fixes
```

Tier 1 → 2 → 3 → 4 → 5. Tier 3's orchestrator drives tier 2, tier 4, and tier 5's `synthesize-report` in sequence. The `analyze-cross-transcript` bucket in tier 4 runs separately from the per-Segment buckets, consuming the consolidated `report.md` outputs of many transcripts at once — and its findings then feed back into `synthesize-report` for a cross-transcript report.

Numbered prefixes only land on grouping folders, never on Skill folders themselves — the Skills spec requires a Skill's folder name to match its `name`.

## Skill flow

How a transcript moves through the skills, top to bottom. **Thick arrows are the main spine** — a transcript flows down them tier by tier, from a picked session to the synthesized report. **Dotted arrows are the side loops** — each tier's optional human-review checkpoint, the `learn-from-*-corrections` edge that feeds corrections back to the draft generator, and the cross-transcript batch pass. Every node is a registered Skill.

```mermaid
flowchart TD
    subgraph T1["Tier 1 · acquire"]
        FA["<b>find-all-claude-code-transcripts-on-local</b><br/>browse local sessions, pick one"]
        GET["<b>get-claude-code-transcript-from-local</b><br/>session id → transcript.json"]
        GEC["<b>gather-external-context</b><br/>+ ticket / PR / user context → external-context.json"]
        REC["<b>review-external-context</b><br/>optional review UI"]
    end

    subgraph T3["Tier 3 · orchestrate"]
        ORCH["<b>analyze-agent-transcript</b><br/>entry point; drives tiers 2, 4, 5"]
    end

    subgraph T2["Tier 2 · decompose"]
        DEC["<b>decompose-agent-transcript-into-transcript-segments</b><br/>transcript.json → Segment tree"]
        REV["<b>review-transcript-segments</b><br/>optional review UI"]
        LSC["<b>learn-from-segment-corrections</b><br/>cluster corrections; flag decomposer fixes"]
    end

    subgraph T4["Tier 4 · analyze"]
        subgraph T4A["per-Segment analyzers — fanned out by the orchestrator"]
            direction LR
            subgraph T4O["analyze-outcomes"]
                FH["analyze-failure-hypothesis"]
                SE["analyze-segment-efficiency"]
            end
            subgraph T4P["analyze-prompts"]
                UP["analyze-user-prompt"]
                PA["analyze-prompt-ambition"]
                GC["pull-together-goal-context"]
            end
            subgraph T4S["analyze-skills"]
                STP["analyze-skill-trigger-performance"]
                SAP["analyze-skill-action-performance"]
                SG["analyze-skill-gaps"]
            end
            subgraph T4M["analyze-mcp"]
                MTP["analyze-mcp-trigger-performance"]
                MAP["analyze-mcp-action-performance"]
                MG["analyze-mcp-gaps"]
            end
        end
        RA["<b>review-analysis</b><br/>optional review UI"]
        LAC["<b>learn-from-analysis-corrections</b><br/>cluster corrections; flag analyzer fixes"]
    end

    subgraph T5["Tier 5 · report"]
        SYN["<b>synthesize-report</b><br/>findings.*.json → findings.report.json + report.md"]
        RR["<b>review-report</b><br/>optional review UI"]
        LRC["<b>learn-from-report-corrections</b><br/>cluster corrections; flag synthesis fixes"]
    end

    subgraph XB["Tier 4 · analyze-cross-transcript — batch pass over many transcripts"]
        XT["<b>analyze-cross-transcript-patterns</b><br/>many report.md → cross-transcript findings"]
    end

    %% main spine — a transcript flows top to bottom
    FA ==>|session id| GET
    GET ==>|transcript.json| GEC
    GEC ==>|transcript.json + external-context.json| ORCH
    ORCH ==> DEC
    DEC ==>|segments.json| T4A
    T4A ==>|findings.*.json| SYN

    %% review + learn loop — one consistent motif per tier
    GEC -.->|checkpoint| REC
    DEC -.->|checkpoint| REV
    REV -.-> LSC
    LSC -.->|flags fixes| DEC
    T4A -.->|checkpoint| RA
    RA -.-> LAC
    LAC -.->|flags fixes| T4A
    SYN -.->|checkpoint| RR
    RR -.-> LRC
    LRC -.->|flags fixes| SYN

    %% cross-transcript — a second pass over many finished reports
    SYN -.->|report.md ×N| XT
    XT -.->|findings.cross-transcript.json| SYN
```

## Design decisions

- **Two data primitives, one downstream contract.** `Transcript` (tier 1 output) carries vendor-coupled detail; `TranscriptSegment` (tier 2 output) is the analysis tree. The downstream tiers read only `segments.json` and dereference event ids back into `transcript.json` for evidence. If either is wrong, fix the producing tier and re-run — don't patch around it downstream.
- **OpenTranscripts is the cross-vendor contract.** Tier 1's output shape is governed by the `open-transcripts` reference set, not by any one vendor's JSONL. When CC changes its format, only the mapping doc + the transformation skill change.
- **External context is gathered once, up front.** A transcript records *what* the agent did; it rarely records *why*. Tier 1's `gather-external-context` pulls the ticket, the PR, and light user context into one `external-context.json` that rides alongside `transcript.json` through every later tier — so no analyzer has to re-derive the Goal's backdrop. It is best-effort (missing sources are recorded, never fatal) and has `review-external-context` as its optional human checkpoint, mirroring tier 2's `review-transcript-segments`.
- **Numbered tiers, not flat buckets.** The execution layers (acquire → decompose → orchestrate → analyze → report) are visible in the directory tree.
- **Grouping folders are never Skills.** `1-acquire/`, `2-decompose/`, `3-orchestrate/`, `4-analyze/`, `5-report/`, and the per-domain buckets under tier 4 contain no `SKILL.md` of their own. That keeps the spec's "everything under a skill folder belongs to that skill" model intact.
- **Four per-Segment tier-4 buckets, three output buckets.** `analyze-outcomes/` is Segment-shaped (failure hypotheses, efficiency); its findings *route* into the three artifact buckets (Prompting / Skills / MCP) via `recommendation_route`. `synthesize-report` (tier 5) follows that route to fold the findings into a clean three-bucket report.
- **Labeling and synthesis are separate tiers.** Tier 4 produces *findings* — flat lists of conclusions. Tier 5 (`synthesize-report`) makes the *leap* from those findings to a prioritized, deduped recommendation slate. Splitting them gives the leap its own review checkpoint (`review-report`) and learn loop (`learn-from-report-corrections`) — the same draft → review → learn shape tiers 2 and 4 already have — instead of burying the synthesis inside the orchestrator where no one could review it.
- **Cross-transcript is tier-4 labeling, not its own tier.** Patterns visible only at scale (recurring prompts, hindsight-as-foresight Segment shapes, time-spend trends) need many reports as input — but they are still *labeling*, the same kind of work as the per-Segment buckets, just at a wider scope. So `analyze-cross-transcript/` lives in tier 4. It runs separately from the per-transcript orchestrator, which would only muddy both if it drove cross-transcript fan-out too — its findings feed `synthesize-report` for a cross-transcript report.
- **Folder hierarchy is for humans.** AIR resolves Skills via `skills.json`, which is flat. The nested folders exist so contributors can see the orchestration shape at a glance.
- **Philosophy docs are the tie-breaker.** The tier-4 analyzers consult the `philosophy-on-skills` and `philosophy-on-mcp` references as they draft findings, and `synthesize-report` cross-checks every recommendation against them at the synthesis step — so the output stays consistent with team stance, not just per-Segment heuristics.
- **Local-first.** Nothing in this plugin uploads or phones home; all analysis happens against the local tmp folder.
