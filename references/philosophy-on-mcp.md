# Philosophy on MCP

> Placeholder. To be filled out by the team.

This document captures the team's stance on **when an MCP server is the right answer** — and when it isn't. Every `analyze-mcp-*` skill in this plugin should consult this document before recommending a `create`, `modify`, or `delete`.

Topics to cover when filled out:

- What is an MCP server, in our team's vocabulary, and what is it *not*?
- When does a capability gap warrant a new MCP server vs. a Skill that wraps an existing CLI vs. better prompting?
- How do we decide between **creating** a new MCP server, **modifying** an existing one (adding/removing tools, changing auth, narrowing scope), or **deleting/replacing** one?
- What is the "right size" for an MCP server's tool surface — too few tools and it's a thin shim; too many and the agent gets lost?
- How do we think about MCP server authentication and credential handling for our team?
- When is an MCP server better expressed as a Skill that calls a CLI, or as a hook, instead?
- How do MCP servers and Skills compose — when should a Skill orchestrate MCP tool calls vs. let the agent invoke them freely?

Until this document is filled out, the analysis skills should fall back on the heuristics in the plugin README and flag findings as "tentative" pending team philosophy.
