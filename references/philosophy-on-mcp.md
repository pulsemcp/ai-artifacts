# Philosophy on MCP

> **Placeholder, with default stance.** The full team philosophy is still to be filled out (Topics list below). The **Default stance** section below captures the rules the team has already converged on — enough for `analyze-mcp-*` to make grounded recommendations today. Findings derived from the Default stance alone should still be flagged `"tentative"` so the reviewer knows they were judged against the defaults rather than a full philosophy.

This document captures the team's stance on **when an MCP server is the right answer** — and when it isn't. Every `analyze-mcp-*` skill in this plugin should consult this document before recommending a `create`, `modify`, or `delete`.

## Default stance

These are the load-bearing rules. Anything the Topics list below ultimately decides differently overrides them — but until then, these are the team's call.

1. **External connections go through MCP.** Anything that talks to a service we don't run in-process — a SaaS API, a remote queue, a vendor webhook, a third-party data source — is expected to be reached through an MCP server. The reason is uniform: auth, retries, response shape, redaction, and observability live in one place per service.
2. **`gh` CLI is the explicit exception.** GitHub access via the `gh` CLI is blessed because so much of our day-to-day shell flow pipes `gh` output through `jq` / `grep` / shell composition, and the current MCP surface doesn't ergonomically replace that. We are waiting on **MCP Code Mode** to be more widely supported before we shift `gh` usage to MCP. Until that lands, raw `gh` from a Skill or inline tool call is fine and should NOT be flagged.
3. **MCP is also reasonable for dependency-heavy tools.** When a capability needs non-trivial dependency installation — Playwright (browsers), language toolchains, headless services, anything that's painful to install on every host — MCP is a good home for it because the `mcp.json` shape ports the install/config description around: configure once in `mcp.json`, every consumer on every host that imports it picks up the same setup. A Skill that says "first install Playwright globally, then…" is fragile in a way an MCP server isn't.
4. **Raw CLIs other than `gh` are acceptable, but get a warning-level recommendation to migrate.** A Skill that wraps a CLI for an external service works — but `analyze-mcp-*` should emit a `tentative`, low/medium-priority recommendation that the capability would be better expressed as an MCP server, citing rules 1 and (if relevant) 3. This is a nudge, not a block: don't escalate to high priority and don't recommend `delete`-ing the Skill until there's a working MCP alternative.

### How this maps to the `analyze-mcp-*` recommendation buckets

- **`create`** (new MCP server) — when the capability is an external connection (rule 1) or dependency-heavy (rule 3) and isn't yet behind MCP. Tentative until the full philosophy is in place.
- **`modify`** (existing MCP server) — narrow the tool surface, fix response shapes, tighten auth, add idempotency guards. Don't gate on the Topics list — these are bug fixes.
- **`delete` / `replace`** — only when the underlying capability is gone or the server has been superseded. Don't recommend deletion just to migrate something from "CLI" to "MCP" — that's a `create` finding plus an eventual cleanup, not a `delete`.
- **Warning-level migrate recommendation** (the rule-4 case) — emit as `create` with `priority: low` (or `medium` if the CLI is causing real pain — error surface, output-size overflow, brittle parsing) and a `tentative: true` flag in `philosophy_check`.

The `gh` exception is hard-coded: if the only "external connection without MCP" you can name is `gh`, **do not emit a finding**.

## Topics to cover when filled out

These are the questions the Default stance doesn't yet answer — when the team writes the full philosophy, each of these gets a section.

- What is an MCP server, in our team's vocabulary, and what is it *not*?
- When does a capability gap warrant a new MCP server vs. a Skill that wraps an existing CLI vs. better prompting?
- How do we decide between **creating** a new MCP server, **modifying** an existing one (adding/removing tools, changing auth, narrowing scope), or **deleting/replacing** one?
- What is the "right size" for an MCP server's tool surface — too few tools and it's a thin shim; too many and the agent gets lost?
- How do we think about MCP server authentication and credential handling for our team?
- When is an MCP server better expressed as a Skill that calls a CLI, or as a hook, instead?
- How do MCP servers and Skills compose — when should a Skill orchestrate MCP tool calls vs. let the agent invoke them freely?

Until those sections exist, anchor recommendations in the Default stance above and the plugin README; carry `tentative: true` in the finding's `philosophy_check`.
