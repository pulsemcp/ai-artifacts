# Phase 2: `2-decompose`

Decomposition layer. Turns an OpenTranscripts `transcript.json` (produced by phase 1) into the recursive **Transcript Segment** tree that every downstream analyzer consumes.

## Skills in this phase

- `decompose-agent-transcript-into-transcript-segments/` — emits `segments.json` (structured) and `flamegraph.html` (annotated viz). Sole producer of the Segment primitive.

## How this phase plugs into the rest

Phase 1 → Phase 2 → Phase 3. The orchestrator that opens Phase 3 and every per-segment analyzer it fans out read the Segment tree and dereference event ids back into `transcript.json` — they never re-walk events from scratch.

When phase 1's `gather-agent-transcript-external-context` has run, `external-context.json` sits in the same `tmp_dir`. Decomposition may read it to ground a Segment's Trigger and Goal in the ticket and PR behind the work, but it is best-effort context, not a required input — the tree is built from `transcript.json` alone when it is absent.

## Design decisions

- **The Segment is a first-class primitive, not an implementation detail of the orchestrator.** Promoting it out makes the data model explicit (the `transcript-segment` reference) and lets the analyzers compose on top of it.
- **Reads OpenTranscripts, not raw vendor JSONL.** Phase 1 owns the vendor coupling; phase 2 is vendor-neutral by construction.
- **One walker, many readers.** This phase walks every event once; everything downstream reads the structured tree. Cheaper than re-walking events in every analyzer.
- **Two artifacts, one truth.** `segments.json` is the source of truth; `flamegraph.html` is the humanizing view. If they disagree, fix `segments.json` first and re-render.
- **Outcome is per-Goal.** A Success sub-step under a Failure parent stays Success. The tree carries enough info for the orchestrator to decide how to aggregate.
- **Decomposition is a draft, not an answer.** It is the most interpretive step in the whole pipeline, so when the tree looks wrong the fix is to re-run this phase rather than to patch around it downstream. Phase 1's deterministic steps need no such re-run.
