# Philosophy on Skills

Consult this before recommending that a Skill be created, modified, or deleted.

For the canonical mechanics of authoring a Skill, the agent **should use a web fetch tool** to read the official best practices at <https://agentskills.io/skill-creation/best-practices>. This document covers the *judgment* layer that sits on top of those mechanics: what kind of Skill is worth building in the first place.

It is grounded in the team's published thinking — [*Team collaboration on agent Skills*](https://www.pulsemcp.com/posts/team-collaboration-on-agent-skills). The throughline: **Skills democratize institutional knowledge** — they capture a company's unique expertise and scale it by redeploying it inside agents. Small, boring steps compound: documenting one bespoke process (your team's git workflow, your release checklist) looks minor until it's multiplied across every layer of the org.

## What a Skill is for

A Skill is a packaged piece of expertise that the model loads on demand when its `description` matches the situation. Skill value sorts into three tiers of durability; the durable one — **bespoke company process** — is where the investment belongs. It encodes things the model cannot reasonably figure out on its own from a generic prompt:

- **Internal systems and conventions** — how *this* team's repos, services, deployment pipeline, knowledge bases (Notion, Jira), and review process actually work. *Your information architecture is unique to you.*
- **Codified internal process** — the team's preferred sequence of steps for a recurring task, including the non-obvious checks and the ordering that matters; onboarding knowledge and "ways of working."
- **Proprietary or hard-to-discover knowledge** — facts about the product, customers, data, market, or competitive landscape that aren't in public training data.

These compound. A Skill that captures "how we ship a migration" or "how we triage a customer-reported bug" stays useful as models improve, because the bespoke content is the point.

## What a Skill is *not* for

- **Generalized best practices.** Skills that restate generic engineering advice (good commit messages, write tests, don't commit secrets) have a short shelf life — *any publicly-available Skill that gains broad appeal is, by definition, general knowledge,* and within a few quarters frontier models absorb it, leaving a legacy Skill that's pure maintenance burden (**skill debt**). If the content would be true at any company, it's a weak Skill candidate. Public Skills (Anthropic's, GitHub repos) are fine as *inspiration* — **fork and customize them to your context** rather than adopting wholesale.
- **Deterministic capabilities.** If the goal is to call an API, authenticate against a service, or query a system reliably, that belongs in an **MCP server** — a prescriptive Skill pinned to a specific API version, CLI, or auth flow *breaks on a major version bump.* If it's a hard rule that should fire on every commit/push/build, that belongs in a **hook** or CI check. Skills are for guidance the model applies with judgment, not for guarantees.
- **One-off context.** If the information is only relevant to a single task or a single repo, a `CLAUDE.md` entry or an inline prompt is usually the right home.

A useful sanity check: if a Skill's body is mostly things a competent generalist model would already do, the Skill is probably not earning its slot.

## The `description` is the trigger

Skills are auto-invoked by the model based on their `description`. A vague description is the most common failure mode — the Skill either never fires or fires on the wrong situations. A good description names the **concrete situation** that should trigger it (the user is doing X, the repo looks like Y, the task involves Z), not just the topic area.

When evaluating an existing Skill, distinguish trigger problems (`description` is wrong) from action problems (the body is wrong). They have different fixes.

## How to author a Skill that earns its slot

The official best practices (linked above) cover mechanics; these are the judgment calls the team stresses on top of them:

- **Don't let an LLM generate a Skill cold.** A model authoring a Skill from scratch has no access to your institutional knowledge — the very thing that makes the Skill worth having.
- **Extract from a real workflow.** Complete a real task in conversation with an agent — providing the context, corrections, and preferences along the way — then extract the reusable pattern from *that* session. First drafts are rough; iterate on them against real-world results.
- **Scope it like a function.** *Deciding what a Skill should cover is like deciding what a function should do* — one cohesive unit of work. Avoid over-comprehensiveness: bloated Skills underperform more than they help.
- **Reference files contextually.** Tell the agent *when* to read which file — "Read `references/api-errors.md` if the API returns a non-200 status code" beats a generic pointer.

## When to create or modify a Skill

Treat these as the canonical signals. At least one should be clearly present before recommending a new or modified Skill:

1. **Mistake despite a correct prompt.** The user asked for the right thing clearly, and the agent still got it wrong in a way that a small piece of team-specific guidance would have prevented.
2. **The same long prompt is being written twice.** If a user is repeatedly typing the same paragraph of context to get a good result, that paragraph wants to be a Skill.
3. **A segment of work is repeated within or across sessions.** Recurring multi-step procedures (open a PR our way, set up a new service, run our release checklist) are prime Skill material.
4. **The agent spins its wheels.** Long detours, repeated failed attempts, or tool-call loops on a task that has a known good path internally.
5. **Foreseeable closed-loop gaps.** The user couldn't write a self-contained prompt because some piece of context is genuinely hard for them to provide up front, but the team knows how to supply it.

If none of these are present, the right recommendation is usually "no Skill" — better prompting, a CLAUDE.md note, or nothing at all.

## When to recommend deletion

- The Skill restates generic best practices that current models handle without help.
- The underlying system or process the Skill encoded no longer exists or has changed enough that the Skill is misleading.
- The Skill's `description` is so broad that it triggers noise more often than signal, and a tighter description isn't possible without rewriting the body.
- The capability has been moved to a more appropriate home (MCP server, hook, CI check) and the Skill is now redundant.

## Team collaboration and the Skill flywheel

Skills are not a solo artifact. The value compounds when they move from one engineer's head into a shared catalog the whole team draws on. The developmental arc the team is building toward:

1. **Create** — an individual drafts the first version, extracted from a real session (see above).
2. **Socialize** — the Skill moves into a shared registry / repo (this catalog) where teammates can find it.
3. **Adopt** — teammates consume Skills built by others instead of re-deriving the same context.
4. **Measure** — track which Skills actually get invoked, and where they fail, to find what's earning its slot.
5. **Refine** — the popular Skills get regular updates that address observed failure modes.
6. **Flywheel** — everyone is continuously creating or maintaining Skills; the catalog stays alive rather than rotting.

This is why the analyzers exist: they turn real session transcripts into the *measure* and *refine* signals. The projected trajectory is an org with a large portfolio of Skills, where a growing share of the work becomes the creation and maintenance of Skills — and eventually of the agents that create and maintain them. When recommending a `create`/`modify`, favor changes that strengthen this shared flywheel (a Skill teammates will reuse, with a description others will actually trigger) over one-off conveniences.

## Output discipline

Recommendations from the analyze-skill-* skills should be specific enough to act on:

- **Create:** name the Skill, draft a `description` that fits the trigger above, and state which of the five signals it addresses.
- **Modify:** identify whether the issue is trigger (`description`) or action (body), and quote the specific situation in the transcript that motivated the change.
- **Delete:** state which of the deletion conditions applies and what (if anything) replaces it.

If the analyzer can't fill in those slots, the finding isn't ready to be a recommendation.
