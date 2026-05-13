# Tier 2: `2-decompose`

Decomposition layer. Turns a raw transcript (JSONL + manifest) into the recursive **Transcript Segment** tree that every downstream analyzer consumes.

## Skills in this tier

- `decompose-into-transcript-segments/` — emits `segments.json` (structured) and `flamegraph.html` (annotated viz). Sole producer of the Segment primitive.

## How this tier plugs into the rest

Tier 1 → Tier 2 → Tier 3. The orchestrator and every per-segment analyzer in Tier 4 read `segments.json` — never the raw JSONL.

## Design decisions

- **The Segment is a first-class primitive, not an implementation detail of the orchestrator.** Promoting it out makes the data model explicit (`references/transcript-segment.md`) and lets the analyzers compose on top of it.
- **One walker, many readers.** This tier walks every turn once; everything downstream reads the structured tree. Cheaper than re-walking JSONL in every analyzer.
- **Two artifacts, one truth.** `segments.json` is the source of truth; `flamegraph.html` is the humanizing view. If they disagree, fix `segments.json` first and re-render.
- **Outcome is per-Goal.** A Success sub-step under a Failure parent stays Success. The tree carries enough info for the orchestrator to decide how to aggregate.
