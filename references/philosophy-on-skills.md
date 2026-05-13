# Philosophy on Skills

Consult this before recommending that a Skill be created, modified, or deleted.

For the canonical mechanics of authoring a Skill, the agent **should use a web fetch tool** to read the official best practices at <https://agentskills.io/skill-creation/best-practices>. This document covers the *judgment* layer that sits on top of those mechanics: what kind of Skill is worth building in the first place.

## What a Skill is for

A Skill is a packaged piece of expertise that the model loads on demand when its `description` matches the situation. The durable value of a Skill comes from encoding things the model cannot reasonably figure out on its own from a generic prompt:

- **Internal systems and conventions** — how *this* team's repos, services, deployment pipeline, and review process actually work.
- **Codified internal process** — the team's preferred sequence of steps for a recurring task, including the non-obvious checks and the ordering that matters.
- **Proprietary or hard-to-discover knowledge** — facts about the product, customers, or data that aren't in public training data.

These compound. A Skill that captures "how we ship a migration" or "how we triage a customer-reported bug" stays useful as models improve, because the bespoke content is the point.

## What a Skill is *not* for

- **Generalized best practices.** Skills that restate generic engineering advice (good commit messages, write tests, don't commit secrets) have a short shelf life — frontier models are increasingly trained on this. If the content would be true at any company, it's a weak Skill candidate.
- **Deterministic capabilities.** If the goal is to call an API, authenticate against a service, or query a system reliably, that belongs in an **MCP server**. If it's a hard rule that should fire on every commit/push/build, that belongs in a **hook** or CI check. Skills are for guidance the model applies with judgment, not for guarantees.
- **One-off context.** If the information is only relevant to a single task or a single repo, a `CLAUDE.md` entry or an inline prompt is usually the right home.

A useful sanity check: if a Skill's body is mostly things a competent generalist model would already do, the Skill is probably not earning its slot.

## The `description` is the trigger

Skills are auto-invoked by the model based on their `description`. A vague description is the most common failure mode — the Skill either never fires or fires on the wrong situations. A good description names the **concrete situation** that should trigger it (the user is doing X, the repo looks like Y, the task involves Z), not just the topic area.

When evaluating an existing Skill, distinguish trigger problems (`description` is wrong) from action problems (the body is wrong). They have different fixes.

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

## Output discipline

Recommendations from the analyze-skill-* skills should be specific enough to act on:

- **Create:** name the Skill, draft a `description` that fits the trigger above, and state which of the five signals it addresses.
- **Modify:** identify whether the issue is trigger (`description`) or action (body), and quote the specific situation in the transcript that motivated the change.
- **Delete:** state which of the deletion conditions applies and what (if anything) replaces it.

If the analyzer can't fill in those slots, the finding isn't ready to be a recommendation.
