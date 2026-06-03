# Philosophy on MCP

This document captures the team's stance on **when an MCP server is the right answer** — and when it isn't; when to **create**, **modify**, or **delete** one. Every `analyze-mcp-*` skill in this plugin should consult this document before recommending a `create`, `modify`, or `delete`.

It is grounded in the team's published thinking — [*How to use MCP effectively*](https://www.pulsemcp.com/posts/how-to-use-mcp-effectively) — distilled into the operational rules below. The **Default stance** section remains the load-bearing, fast-path ruleset the analyzers lean on; the sections after it fill in the *why* and the harder calls (selection, sizing, configuration, emerging capabilities). A handful of genuinely open questions remain in **Still open** at the end — findings that turn on those should still be flagged `tentative`.

## Default stance

These are the load-bearing rules — the fast path for `analyze-mcp-*`. The sections after them ground and extend these rules; nothing below overrides them.

1. **External connections go through MCP.** Anything that talks to a service we don't run in-process — a SaaS API, a remote queue, a vendor webhook, a third-party data source — is expected to be reached through an MCP server. The reason is uniform: auth, retries, response shape, redaction, and observability live in one place per service.
2. **`gh` CLI is the explicit exception.** GitHub access via the `gh` CLI is blessed because so much of our day-to-day shell flow pipes `gh` output through `jq` / `grep` / shell composition, and the current MCP surface doesn't ergonomically replace that. We are waiting on **MCP Code Mode** to be more widely supported before we shift `gh` usage to MCP. Until that lands, raw `gh` from a Skill or inline tool call is fine and should NOT be flagged.
3. **MCP is also reasonable for dependency-heavy tools.** When a capability needs non-trivial dependency installation — Playwright (browsers), language toolchains, headless services, anything that's painful to install on every host — MCP is a good home for it because the `mcp.json` shape ports the install/config description around: configure once in `mcp.json`, every consumer on every host that imports it picks up the same setup. A Skill that says "first install Playwright globally, then…" is fragile in a way an MCP server isn't.
4. **Raw CLIs other than `gh` are acceptable, but get a warning-level recommendation to migrate.** A Skill that wraps a CLI for an external service works — but `analyze-mcp-*` should emit a `tentative`, low/medium-priority recommendation that the capability would be better expressed as an MCP server, citing rules 1 and (if relevant) 3. This is a nudge, not a block: don't escalate to high priority and don't recommend `delete`-ing the Skill until there's a working MCP alternative.

### How this maps to the `analyze-mcp-*` recommendation buckets

- **`create`** (new MCP server) — when the capability is an external connection (rule 1) or dependency-heavy (rule 3) and isn't yet behind MCP, and there's a recurring/shared workflow behind it (see *When an MCP server is the right answer*). Flag `tentative` for the rule-4 migrate nudge (below) and for the **Still open** cases at the end.
- **`modify`** (existing MCP server) — narrow the tool surface, fix response shapes, tighten auth, add idempotency guards. These are bug fixes — don't gate them on the open questions below.
- **`delete` / `replace`** — only when the underlying capability is gone or the server has been superseded. Don't recommend deletion just to migrate something from "CLI" to "MCP" — that's a `create` finding plus an eventual cleanup, not a `delete`.
- **Warning-level migrate recommendation** (the rule-4 case) — emit as `create` with `priority: low` (or `medium` if the CLI is causing real pain — error surface, output-size overflow, brittle parsing) and a `tentative: true` flag.

The `gh` exception is hard-coded: if the only "external connection without MCP" you can name is `gh`, **do not emit a finding**.

## When an MCP server is the right answer

Two situations are the bread and butter:

1. **Integrating with an external system** the agent doesn't run in-process — Jira, Slack, DataDog, Postgres, a vendor API. (Default stance rule 1.)
2. **Wrapping a heavy local dependency** that's painful to install and configure on every host — Playwright (browsers), language toolchains, headless services. (Default stance rule 3.)

But the higher-order reason MCP earns its keep is **operationalization**: MCP *shines when you start to share with your team and operationalize these workflows.* For purely single-player, throwaway, or experimental work, a CLI or an inline tool call is often enough — the cost of standing up and maintaining an MCP server isn't repaid until more than one person, or more than one session, depends on it. When `analyze-mcp-*` proposes a new server, it should be able to name the *recurring, shared* workflow it serves; "this one session would have been marginally smoother" is not enough.

### What MCP actually standardizes

These are the three things you're buying when you reach for MCP — and the reasons the Default stance routes external connections through it:

- **Portability & shareability** — *copy a JSON file from one setup to another, and your coding agent immediately has deterministic instructions on connecting to the relevant capabilities.* The `mcp.json` shape carries the install/config/connection description around, so every consumer on every host picks up the same setup.
- **Auth** — one unified approach to *permissioning scenarios you might encounter without having to re-implement and re-design on a case by case basis.*
- **Governance** — *every MCP call has a predictable, reliable format for how information and access flows across systems*: auth, retries, response shape, redaction, and observability live in one place per service.

## How to source an MCP server (selection hierarchy)

When a capability gap calls for an MCP server, prefer options in this order — earlier options are more reliable and lower-maintenance:

1. **Lean on teammates** — use what's already in the team/org catalog before standing up anything new.
2. **Official, vendor-hosted (HTTP) server** — the vendor maintains and runs it; least to break, nothing to install.
3. **Official self-hosted server** — vendor-built, your infra team runs it.
4. **Official local server** — installed per host via `npx` / `uvx` / `docker`.
5. **Community-maintained local server** — usable, but accept higher supply-chain risk and pin/verify accordingly.
6. **Build it locally** — a custom server when no official option covers the need.
7. **Build and host it** — for internal systems that need advanced auth or to be packaged as a product.

`analyze-mcp-*` `create` findings should point at the *highest* rung that plausibly satisfies the gap, not jump straight to "build one" when an official server already exists.

## Configuration constraints are a feature

A server's configuration is also a safety surface. Prefer **scoped configuration profiles** over one all-powerful connection — e.g. a read-only database profile for routine work and a separate read-write profile reserved for *high-risk, surgical changes you intend to copilot closely.* When recommending a `modify`, tightening an over-broad configuration (narrowing scope, splitting `ro`/`rw`, constraining the tool surface) is a legitimate and high-value finding, not just bug-fixing response shapes.

## The "right size" of a tool surface

Too few tools and the server is a thin shim that barely beats a CLI; too many and the agent gets lost choosing among them. A `modify` recommendation to **narrow** an overgrown surface — or to **split** one sprawling server into focused ones — is as valid as adding a missing tool. Judge the surface by whether an agent can reliably pick the right tool for the situations the server is meant to cover.

## When NOT to reach for MCP

- **`gh` and the like.** A CLI that *every engineer likely already has installed and auth configured* — and whose output composes naturally through `jq`/`grep`/shell — can stay a CLI. This is the Default-stance `gh` exception; see rules 2 and 4. Don't flag it.
- **Single-player / experimental work** with no recurring or shared workflow behind it (see *When an MCP server is the right answer* above).
- **Hard rules that must fire on every commit/push/build.** Those belong in a hook or CI check, not an MCP server.

## Emerging capabilities

The protocol is moving; two additions worth weighing when shaping a `create`/`modify`:

- **Elicitations** let a server make a *deterministic user-approval request* at a specific decision point — a clean way to keep **human accountability** at the moments that matter without dragging the human into every turn. Prefer an elicitation at the one risky step over an open loop that pauses constantly.
- **MCP Apps** introduce richer visual form factors for knowledge work that a text/CLI interface handles poorly. When a capability is really about *seeing* and manipulating something visual, a CLI-wrapping Skill is the wrong shape — note the MCP Apps direction.

## Still open

A few questions the published philosophy doesn't fully settle. Findings that turn primarily on these should be flagged `tentative`:

- The precise credential-handling and secret-storage conventions for *our* team's self-hosted/built servers.
- When a Skill that orchestrates several MCP tool calls is better than letting the agent invoke them freely.
- The exact threshold at which a shared workflow is "operationalized enough" to justify building (rung 6) or hosting (rung 7) a server rather than living with a CLI.

Anchor everything else in the rules above and the plugin README.
