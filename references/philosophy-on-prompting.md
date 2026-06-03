# Philosophy on Prompting

This document captures the team's stance on **what a good prompt is** — and, specifically, on **closing the agentic loop**: turning a short, hand-held back-and-forth into a prompt the agent can run to a verifiable finish on its own. The prompting analyzers in this plugin — `analyze-agent-transcript-user-prompt` (which judges whether a Segment's Trigger *closed the loop*) and `analyze-agent-transcript-prompt-ambition` (which judges scope and deterministic-trigger candidacy) — should consult this document before drafting a prompting recommendation.

It is grounded in the team's published thinking — [*Closing the agentic loop*](https://www.pulsemcp.com/posts/closing-the-agentic-loop-mcp-use-case) — and reads as a peer of [`philosophy-on-skills`](philosophy-on-skills.md) and [`philosophy-on-mcp`](philosophy-on-mcp.md): a Skill encodes bespoke process, an MCP server connects to where the work lives, and a **closed-loop prompt** is what sets the agent running across both without the human in the per-iteration seat.

## Open vs. closed loops

An LLM agent runs tools in a loop to achieve a goal. The question is who sits inside that loop:

- An **open loop** keeps the human in the driver's seat, making most decisions: ask, read the answer, observe, come back with a correction — *"just one more loop,"* four or five times, until the output is acceptable. This is slow and frustrating, and *whenever you yourself are a critical part of that loop, everything slows to a crawl.*
- A **closed loop** takes the human out of the per-iteration equation. The agent *verifiably completes the task without asking the user for any input along the way* — it drafts, steps back, sees how it looks, and digs back in to iterate, the way a human works, rather than stopping to ask at every stage.

In `transcript-segment` terms: a closed-loop Trigger sets up a Goal the agent can carry to a Success Outcome on its own. An open loop shows up as a chain of short user-source Segments — many Triggers, much steering, the human supplying the judgment the prompt should have encoded.

## Why closing the loop is the goal

There's a hard ceiling on the leverage an engineer gets from AI if an average conversation turn hovers around 1–2 minutes (Claude Code's median turn is ~45 seconds). Turn by turn it always feels more productive to fire "just one more prompt" than to step back and re-think the prompt — so the human stays glued to the loop. At the opposite extreme, an aimless long-running loop churns for days producing unhelpful deliverables.

The happy medium is a **closed agentic loop scoped to a typical engineering task**: write a prompt, get a PR ready to merge. Step one is turning 1–2 minute cycles into productive 10–20 minute cycles. Once a prompt reliably runs that long on its own, the mindset shifts **from speed to correctness** — the question becomes whether those long autonomous runs adhere to the team's engineering standards, not how fast each turn returns.

## It starts with an end-to-end "definition of done"

Don't prompt step-by-step. *"Add a REST endpoint like `GET /api/accounts` but for invoices"* produces a long tail of papercuts — routes, migration, serializer, tests — each needing another turn. Instead, **work backwards from done**: if the task were successfully accomplished, what would that look like? State that whole outcome up front:

> *"Implement a feature that lets a user view and filter their past invoices by date range and status, complete with the analytics/telemetry an admin can analyze and that can trigger an alert."*

A definition of done is about the **outcome, independent of the implementation path** — it doesn't track *how* the agent gets there, only what "there" is. In Segment terms, an ambitious, closed-loop Trigger names one rich Goal whose Outcome is objectively checkable; an under-scoped prompt names a fragment and forces the user to open the next Segment, and the next.

## Verification closes the loop

Ask the question a reviewer asks: **how would you actually test that the definition of done is achieved?** Like sanity-checking a junior engineer's PR — seed a local DB, open a browser, log in, click around, query the analytics, trip the alert. The move that closes the loop is to **give the agent the same capabilities a reviewer would use**, then tell it to keep iterating until verifiably done:

> *"After completion, verify using `<MCP server>` that `<definition of done>`. Keep iterating until it validates."*

Given those capabilities, the agent iterates on its own — early passes error out, but it accrues the context to get end-to-end. First deliverables won't be perfect, but you iterate far fewer times than pair-programming would, shedding toil on the way to the happy path. This works **even better designed as a subagent using a different model**, whose fresh perspective sidesteps the originating context's blind spots.

The capabilities almost always live behind an MCP server (a browser via Playwright, a database, a staging login) — which is exactly why prompting, Skills, and MCP are one system: *the magic happens when you plug in quality MCP servers for the services where your work actually lives.*

## Observability keeps the loop tight

Closed-loop verification relies on **eventual convergence** — every iteration has to make *some* progress. Sometimes verifying *is* observing enough; sometimes it isn't, especially on long loops (a production 500 whose cause hides in prod data state or server logs). Give the agent the same debugging instruments a human engineer has: **access to logs, data, and deploy status across production (read-only), staging, and local.** Including, say, staging-log access while debugging can cut a fix from dozens of attempts to one or two. Without observability the agent is flying blind and the loop stops converging.

## Closing the loop is just the first step

Long-running closed loops don't immediately emit perfect code — but their real payoff is that **they expose your agents' failure modes**. Each failure mode points at the next well-placed investment: a missing piece of bespoke process wants an **Agent Skill**; a capability gap to an external system wants an **MCP server**; a recurring project convention wants an **AGENTS.md / CLAUDE.md** note. Much like ramping a new engineer, you watch where they stumble and supply the missing context. This is the bridge from the prompting bucket back into the Skills and MCP buckets: a prompt that couldn't close its loop is a signal, and the analyzer's job is to route that signal to whichever home will close it next time.

## How this maps to the prompting analyzers

- **`analyze-agent-transcript-user-prompt`** judges `closed_loop`. A Trigger is closed-loop when it carried an end-to-end definition of done and (where needed) the verification + observability hooks for the agent to finish unaided. When it broke, classify *why*: a fixable prompting issue (no definition of done, missing verification criteria, ambiguity) → a `prompting` recommendation; or a foreseeable capability gap the prompt couldn't have closed (no browser, no log access, no MCP server for the system the work lives in) → route to `skills` / `mcp`. Don't penalize an otherwise well-formed prompt for an infra failure unrelated to its merit.
- **`analyze-agent-transcript-prompt-ambition`** judges scope. *Ambition is not longer prompts* — a one-sentence prompt that sets up a whole well-scoped definition of done is **more** ambitious than a four-paragraph prompt that hand-holds every step. A short user-source New Trigger quickly followed by another overlapping one is the open-loop "split work" smell; the recommendation is the single combined definition-of-done prompt. The north-star case stays the **deterministic trigger** — a closed loop is most valuable when an external event (an alert, a schedule, a PR opening) fires it instead of a human typing it.

Recommendations should be concrete enough to act on: quote the moment the loop broke, and state either the better prompt (a definition of done plus how the agent should verify it) or the Skill/MCP/AGENTS.md investment that would let the next prompt close.
