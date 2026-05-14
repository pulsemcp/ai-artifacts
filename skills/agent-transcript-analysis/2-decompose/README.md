# Tier 2: `2-decompose`

Decomposition layer. Turns an OpenTranscripts `transcript.json` (produced by tier 1) into the recursive **Transcript Segment** tree that every downstream analyzer consumes — and gives a human the chance to correct that tree before the analyzers run on it.

## Skills in this tier

- `decompose-agent-transcript-into-transcript-segments/` — emits `segments.json` (structured) and `flamegraph.html` (annotated viz). Sole producer of the Segment primitive.
- `review-transcript-segments/` — **optional human review checkpoint.** Opens a localhost UI to audit and correct the AI-drafted tree; writes `segments.reviewed.json` next to the draft with full correction provenance. The draft is never overwritten.
- `learn-from-segment-corrections/` — **optional feedback loop.** Reads the corrections captured by `review-transcript-segments`, clusters them into patterns, and flags concrete improvement opportunities for `decompose-agent-transcript-into-transcript-segments` — it does not edit any skill.

## How this tier plugs into the rest

Tier 1 → Tier 2 → Tier 3. The orchestrator that opens Tier 3 and every per-segment analyzer it fans out read the Segment tree and dereference event ids back into `transcript.json` — they never re-walk events from scratch.

When tier 1's `gather-external-context` has run, `external-context.json` (or its reviewed sibling) sits in the same `tmp_dir`. Decomposition may read it to ground a Segment's Trigger and Goal in the ticket and PR behind the work, but it is best-effort context, not a required input — the tree is built from `transcript.json` alone when it is absent.

Downstream readers go through the `load_bundle` helper in `review-transcript-segments`'s bundled `segment_review.py`, which **prefers `segments.reviewed.json` when it exists** and falls back to `segments.json`. Because the reviewed file is schema-compatible with the draft, no analyzer needs to know whether a human touched the tree.

The review subsystem is its own loop:

```
decompose-agent-transcript-into-transcript-segments  →  segments.json (AI draft)
review-transcript-segments                           →  segments.reviewed.json + append-only correction log
learn-from-segment-corrections                       →  flagged opportunities for decompose-agent-transcript-into-transcript-segments
       └──────────────────────── close the loop ────────────────────────┘
```

## Design decisions

- **The Segment is a first-class primitive, not an implementation detail of the orchestrator.** Promoting it out makes the data model explicit (the `transcript-segment` reference) and lets the analyzers compose on top of it.
- **Reads OpenTranscripts, not raw vendor JSONL.** Tier 1 owns the vendor coupling; tier 2 is vendor-neutral by construction.
- **One walker, many readers.** This tier walks every event once; everything downstream reads the structured tree. Cheaper than re-walking events in every analyzer.
- **Two artifacts, one truth.** `segments.json` is the source of truth; `flamegraph.html` is the humanizing view. If they disagree, fix `segments.json` first and re-render.
- **Outcome is per-Goal.** A Success sub-step under a Failure parent stays Success. The tree carries enough info for the orchestrator to decide how to aggregate.
- **Decomposition is a draft, not an answer.** It is the most interpretive step in the whole pipeline, so its output is reviewable: `review-transcript-segments` lets a human correct it, and `segments.json` is kept pristine so the AI-vs-human diff stays inspectable. Tier 1's deterministic steps need no such checkpoint.
- **Corrections are signal.** The review UI records *why* a human disagreed, not just *what* they changed — a structured, replayable correction log — so `learn-from-segment-corrections` can turn those disagreements into flagged improvement opportunities for the decomposer.
