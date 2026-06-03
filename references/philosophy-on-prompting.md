# Philosophy on Prompting

This document captures the team's stance on **what a good prompt is** — and, specifically, on **closing the agentic loop**: turning a short, hand-held back-and-forth into a prompt the agent can run to a verifiable finish on its own. The prompting analyzers in this plugin — `analyze-agent-transcript-user-prompt` (which judges whether a Segment's Trigger *closed the loop*) and `analyze-agent-transcript-prompt-ambition` (which judges scope and deterministic-trigger candidacy) — should consult this document before drafting a prompting recommendation.

It is grounded in the team's published thinking — [*Closing the agentic loop*](https://www.pulsemcp.com/posts/closing-the-agentic-loop-mcp-use-case) — and reads as a peer of `philosophy-on-skills` and `philosophy-on-mcp`: a Skill encodes bespoke process, an MCP server connects to where the work lives, and a **closed-loop prompt** is what sets the agent running across both without the human in the per-iteration seat.

## Open vs. closed loops

An LLM agent runs tools in a loop to achieve a goal. The question is who sits inside that loop:

- An **open loop** keeps the human in the driver's seat, making most decisions: ask, read the answer, observe, come back with a correction — "just one more loop," four or five times, until the output is acceptable. This is slow and frustrating; as the post puts it, *whenever you yourself are a critical part of that loop, everything slows to a crawl.*
- A **closed loop** takes the human out of the per-iteration equation. The agent verifiably completes the task without asking the user for input along the way — it drafts, steps back, sees how it looks, and digs back in to iterate, the way a human works, rather than stopping to ask at every stage.

In `transcript-segment` terms: a closed-loop Trigger sets up a Goal the agent can carry to a Success Outcome on its own. An open loop shows up as a chain of short user-source Segments — many Triggers, much steering, the human supplying the judgment the prompt should have encoded.

## Why closing the loop is the goal

Turn by turn, it always feels more productive to fire one more short prompt than to step back and re-think the prompt — so the human stays glued to the loop, supplying judgment at every turn. The team frames the cost concretely: instead of *writing a good closed-loop prompt in 30 seconds (and waiting 10 minutes, while you do something else),* you're *stuck writing a prompt in 30 seconds, waiting 10, writing for another 30; repeat for 20 minutes.* Close the loop and *the implementation will be an order of magnitude better than if you had only used the first, unclosed-loop prompt.*

The happy medium is a **closed agentic loop scoped to a typical engineering task** — a prompt that runs on its own long enough to bring real work to a verifiable finish, without churning aimlessly for days on an under-specified goal. Once a prompt reliably runs that long unaided, the question stops being how fast each turn returns and becomes whether the autonomous run adheres to the team's engineering standards.

## It starts with an end-to-end "definition of done"

Don't prompt step-by-step. A closed-loop prompt names what *done* is up front, then lets the agent find the path — the team's framing is to *declare a "definition of done" that doesn't rely on the path to getting there.* The example outside engineering makes it concrete: a salesperson *may "verify they are done" with their outreach for the day by taking a beat to verify that "every contact in the CRM has 'Status' set to 'Outreached'."* The engineering equivalent is naming the whole outcome — the feature works, covers its edge cases, has the telemetry an admin can read — not the routes-then-migration-then-serializer sequence that produces a long tail of papercuts, each needing another turn.

A definition of done is about the **outcome, independent of the implementation path** — it doesn't track *how* the agent gets there, only what "there" is. In Segment terms, an ambitious, closed-loop Trigger names one rich Goal whose Outcome is objectively checkable; an under-scoped prompt names a fragment and forces the user to open the next Segment, and the next.

## Verification closes the loop

*Without a verification mechanism, your agentic loop remains unclosed.* To introduce one, **work backwards**: *if your task were successfully accomplished, what would that look like?* — then give the agent the same capabilities a reviewer would use to check it. Like sanity-checking a junior engineer's PR: seed a local DB, open a browser, log in, click around, read the analytics. The move that closes the loop is to hand the agent those capabilities and tell it to keep iterating until the definition of done verifiably holds — a pattern like "after completion, verify via the available tools that `<definition of done>`, and keep iterating until it validates."

Given those capabilities, the agent iterates on its own — early passes error out, but it accrues the context to get end-to-end, and you iterate far fewer times than pair-programming would. This works **even better designed as a subagent using a different model**, whose fresh perspective sidesteps the originating context's blind spots.

The capabilities almost always live behind an MCP server (a browser via Playwright, a database, a staging login) — which is exactly why prompting, Skills, and MCP are one system: *the magic happens when you plug in quality MCP servers for the services where your work actually lives.*

## Observability keeps the loop tight

Verifying is sometimes enough on its own; sometimes it isn't — especially on long loops, like a production 500 whose cause hides in prod data state or server logs. *Enhanced observability via MCP is often a nice-to-have — but still sometimes critical to evolving a workflow from demo to practical part of your toolbox.* Give the agent the same debugging instruments a human engineer reaches for first: access to logs, data, and deploy status across production (read-only), staging, and local. Reading staging logs while fixing a bug is one of the first and most recurring things an engineer does — handing the agent that same view is often what keeps a long loop converging instead of guessing blind.

## Closing the loop is just the first step

Long-running closed loops don't immediately emit perfect code — but their real payoff is that **they expose your agents' failure modes**. Each failure mode points at the next well-placed investment: a missing piece of bespoke process wants an **Agent Skill**; a capability gap to an external system wants an **MCP server**; a recurring project convention wants an **AGENTS.md / CLAUDE.md** note. Much like ramping a new engineer, you watch where they stumble and supply the missing context. This is the bridge from the prompting bucket back into the Skills and MCP buckets: a prompt that couldn't close its loop is a signal, and the analyzer's job is to route that signal to whichever home will close it next time.

## How this maps to the prompting analyzers

- **`analyze-agent-transcript-user-prompt`** judges `closed_loop`. A Trigger is closed-loop when it carried an end-to-end definition of done and (where needed) the verification + observability hooks for the agent to finish unaided. When it broke, classify *why*: a fixable prompting issue (no definition of done, missing verification criteria, ambiguity) → a `prompting` recommendation; or a foreseeable capability gap the prompt couldn't have closed (no browser, no log access, no MCP server for the system the work lives in) → route to `skills` / `mcp`. Don't penalize an otherwise well-formed prompt for an infra failure unrelated to its merit.
- **`analyze-agent-transcript-prompt-ambition`** judges scope. *Ambition is not longer prompts* — a one-sentence prompt that sets up a whole well-scoped definition of done is **more** ambitious than a four-paragraph prompt that hand-holds every step. A short user-source New Trigger quickly followed by another overlapping one is the open-loop "split work" smell; the recommendation is the single combined definition-of-done prompt. The north-star case stays the **deterministic trigger** — a closed loop is most valuable when an external event (an alert, a schedule, a PR opening) fires it instead of a human typing it.

Recommendations should be concrete enough to act on: quote the moment the loop broke, and state either the better prompt (a definition of done plus how the agent should verify it) or the Skill/MCP/AGENTS.md investment that would let the next prompt close.
